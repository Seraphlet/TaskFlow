import unittest

from fastapi.testclient import TestClient

from server.app import app


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


if __name__ == "__main__":
    unittest.main()
