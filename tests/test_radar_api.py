import asyncio
import json
import sqlite3
import unittest
from datetime import timedelta
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from server.app import (
    EXPLORE_LOCKS,
    IDENTITY_SECRET,
    TAVILY_CREDIT_COSTS,
    Credentials,
    ExploreRequest,
    Profile,
    ProviderRequest,
    app,
    credential_identity,
    explore,
    iso,
    parse_deepseek_json,
    recover_unreceived_batch,
    reserve_credits,
    tavily_search,
    utc_now,
)


class RadarApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_health_and_static_frontend(self):
        self.assertEqual(self.client.get("/api/radar/health").json()["status"], "ok")
        self.assertIn("Toward the Sea", self.client.get("/").text)
        self.assertEqual(self.client.get("/js/app.js").status_code, 200)

    def test_home_background_supports_cache_revalidation(self):
        first = self.client.get("/images/home-background.webp")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers["cache-control"], "public, max-age=0, must-revalidate")
        self.assertEqual(first.headers["content-type"], "image/webp")
        self.assertIn("etag", first.headers)
        self.assertIn("last-modified", first.headers)
        second = self.client.get("/images/home-background.webp", headers={"If-None-Match": first.headers["etag"]})
        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.content, b"")

    def test_server_files_are_not_public(self):
        self.assertEqual(self.client.get("/server/data/.identity-secret").status_code, 404)
        self.assertEqual(self.client.get("/.git/config").status_code, 404)

    def test_invalid_model_is_clear_and_does_not_call_upstream(self):
        response = self.client.post(
            "/api/radar/test",
            json={
                "credentials": {"tavilyApiKey": "tvly-not-a-real-key", "deepseekApiKey": "sk-not-a-real-key"},
                "modelId": "gpt-4",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("deepseek-", response.json()["detail"])
        self.assertNotIn("tvly-not-a-real-key", response.text)
        self.assertNotIn("sk-not-a-real-key", response.text)

    def test_validation_errors_never_echo_credentials(self):
        response = self.client.post(
            "/api/radar/test",
            json={"credentials": {"tavilyApiKey": "short", "deepseekApiKey": "tiny"}, "modelId": "deepseek-flash"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("short", response.text)
        self.assertEqual(response.json()["detail"], "请求结构无效，请检查凭证、模型 ID 和 Profile 字段")

    def test_deepseek_json_parser_accepts_common_wrappers(self):
        expected = {"items": [{"title": "测试"}]}
        self.assertEqual(parse_deepseek_json('{"items":[{"title":"测试"}]}'), expected)
        self.assertEqual(parse_deepseek_json('```json\n{"items":[{"title":"测试"}]}\n```'), expected)
        self.assertEqual(parse_deepseek_json('以下是结果：\n{"items":[{"title":"测试"}]}\n完成。'), expected)

    def test_deepseek_json_parser_reports_empty_and_truncated_content(self):
        with self.assertRaisesRegex(ValueError, "空内容"):
            parse_deepseek_json("")
        with self.assertRaisesRegex(ValueError, "长度上限"):
            parse_deepseek_json('{"items": [', "length")
        with self.assertRaisesRegex(ValueError, "完整的 JSON"):
            parse_deepseek_json('{"items": [')

    def test_recovers_completed_batch_not_received_by_browser(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE inbox (id INTEGER PRIMARY KEY, identity TEXT, profile_id TEXT, payload TEXT, created_at TEXT)")
        payload = {
            "items": [{"id": "live_1", "section": "Core Domain"}],
            "shortages": {},
            "provider": "Tavily + DeepSeek",
            "modelId": "deepseek-flash",
            "exhausted": False,
        }
        db.execute("INSERT INTO inbox(identity,profile_id,payload,created_at) VALUES(?,?,?,?)", ("person", "profile", json.dumps(payload), "now"))
        recovered = recover_unreceived_batch(db, "person", "profile", "deepseek-flash", [])
        self.assertTrue(recovered["replayed"])
        self.assertEqual(recovered["items"][0]["id"], "live_1")
        self.assertIsNone(recover_unreceived_batch(db, "person", "profile", "deepseek-flash", ["live_1"]))


class RadarConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_second_search_for_same_credentials(self):
        request = ExploreRequest(
            credentials=Credentials(tavilyApiKey="tvly-lock-test", deepseekApiKey="sk-lock-test"),
            modelId="deepseek-flash",
            profile=Profile(id="profile", name="Profile"),
        )
        identity = credential_identity(IDENTITY_SECRET, "tvly-lock-test", "sk-lock-test")
        lock = EXPLORE_LOCKS.setdefault(identity, asyncio.Lock())
        await lock.acquire()
        try:
            with self.assertRaises(HTTPException) as raised:
                await explore(request)
            self.assertEqual(raised.exception.status_code, 409)
            self.assertIn("搜索正在进行", raised.exception.detail)
        finally:
            lock.release()
            EXPLORE_LOCKS.pop(identity, None)


class RadarBudgetTests(unittest.IsolatedAsyncioTestCase):
    def usage_db(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE monthly_usage(identity TEXT, month TEXT, searches INTEGER DEFAULT 0, credits INTEGER DEFAULT 0, PRIMARY KEY(identity,month))")
        db.execute("CREATE TABLE search_cache(identity TEXT, query_hash TEXT, payload TEXT, expires_at TEXT, PRIMARY KEY(identity,query_hash))")
        return db

    def test_official_depth_costs_and_atomic_budget(self):
        self.assertEqual(TAVILY_CREDIT_COSTS["basic"], 1)
        self.assertEqual(TAVILY_CREDIT_COSTS["advanced"], 2)
        db = self.usage_db()
        with patch("server.app.MONTHLY_CREDIT_BUDGET", 3):
            self.assertEqual(reserve_credits(db, "person", 2), 2)
            self.assertEqual(reserve_credits(db, "person", 1), 3)
            with self.assertRaises(HTTPException) as raised:
                reserve_credits(db, "person", 1)
            self.assertEqual(raised.exception.status_code, 429)
        row = db.execute("SELECT searches,credits FROM monthly_usage").fetchone()
        self.assertEqual((row["searches"], row["credits"]), (2, 3))

    async def test_cache_hit_uses_zero_new_credits(self):
        db = self.usage_db()
        query = "cached query"
        from server.app import query_hash
        db.execute(
            "INSERT INTO search_cache(identity,query_hash,payload,expires_at) VALUES(?,?,?,?)",
            ("person", query_hash(f"tavily:basic\0{query}"), json.dumps([{"url":"https://example.com"}]), iso(utc_now()+timedelta(hours=1))),
        )
        results, usage = await tavily_search(db, "person", "tvly-valid-key", query, "sk-valid-key")
        self.assertEqual(results[0]["url"], "https://example.com")
        self.assertEqual(usage["cacheHits"], 1)
        self.assertEqual(usage["tavilyCredits"], 0)
        self.assertIsNone(db.execute("SELECT * FROM monthly_usage").fetchone())

    async def test_missing_tavily_uses_deepseek_without_tavily_budget(self):
        db = self.usage_db()
        with patch("server.app.deepseek_search", AsyncMock(return_value=[{"url":"https://example.com","content":"x"}])) as search:
            _results, usage = await tavily_search(db, "person", "", "query", "sk-valid-key")
        search.assert_awaited_once()
        self.assertEqual(usage["deepseekSearchRequests"], 1)
        self.assertEqual(usage["tavilyRequests"], 0)
        self.assertIsNone(db.execute("SELECT * FROM monthly_usage").fetchone())

    async def test_confirmed_tavily_usage_reconciles_reserved_credits(self):
        db = self.usage_db()

        class FakeResponse:
            status_code = 200
            is_success = True

            @staticmethod
            def json():
                return {
                    "results": [{"url": "https://example.com", "title": "Example", "content": "Result"}],
                    "usage": {"credits": 2},
                }

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                return FakeResponse()

        with patch("server.app.TAVILY_SEARCH_DEPTH", "basic"), patch("server.app.httpx.AsyncClient", return_value=FakeClient()):
            results, usage = await tavily_search(db, "person", "tvly-valid-key", "live query", "sk-valid-key")

        self.assertEqual(results[0]["url"], "https://example.com")
        self.assertEqual(usage["tavilyRequests"], 1)
        self.assertEqual(usage["tavilyCredits"], 2)
        self.assertEqual(usage["accounting"], "confirmed")
        row = db.execute("SELECT searches,credits FROM monthly_usage").fetchone()
        self.assertEqual((row["searches"], row["credits"]), (1, 2))

    async def test_connection_test_never_calls_search_api(self):
        payload = ProviderRequest(credentials=Credentials(tavilyApiKey="tvly-configured", deepseekApiKey="sk-valid-key"), modelId="deepseek-flash")
        with patch("server.app.deepseek_json", AsyncMock(return_value={"ok": True})) as model_call, patch("server.app.tavily_search", AsyncMock()) as search_call:
            from server.app import test_connection
            result = await test_connection(payload)
        model_call.assert_awaited_once()
        search_call.assert_not_called()
        self.assertFalse(result["tavily"]["tested"])
        self.assertIn("不会调用搜索", result["note"])


if __name__ == "__main__":
    unittest.main()
