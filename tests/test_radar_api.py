import asyncio
import json
import sqlite3
import unittest

from fastapi import HTTPException
from fastapi.testclient import TestClient

from server.app import (
    EXPLORE_LOCKS,
    IDENTITY_SECRET,
    Credentials,
    ExploreRequest,
    Profile,
    app,
    credential_identity,
    explore,
    parse_deepseek_json,
    recover_unreceived_batch,
)


class RadarApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_health_and_static_frontend(self):
        self.assertEqual(self.client.get("/api/radar/health").json()["status"], "ok")
        self.assertIn("TaskFlow Workspace", self.client.get("/").text)
        self.assertEqual(self.client.get("/js/app.js").status_code, 200)

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
            json={"credentials": {"tavilyApiKey": "short", "deepseekApiKey": "also-short"}, "modelId": "deepseek-flash"},
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


if __name__ == "__main__":
    unittest.main()
