import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from server.app import app, repair_generated_life_story, validate_generated_life_story


def valid_story():
    characters = [
        {"id":"mother","name":"林岚","role":"parent","birthTime":0,"endTime":78,"initialState":{"health":.8,"resources":.4,"mood":.6,"education":.1,"stability":.6}},
        {"id":"main","name":"林澄","role":"primary","birthTime":24,"endTime":88,"initialState":{"health":.82,"resources":.45,"mood":.62,"education":.08,"stability":.68}},
        {"id":"daughter","name":"林遥","role":"child","birthTime":52,"endTime":105,"initialState":{"health":.85,"resources":.56,"mood":.67,"education":.08,"stability":.7}},
    ]
    events = [
        {"id":"m0","characterId":"mother","time":0,"type":"birth","title":"林岚出生"},
        {"id":"m1","characterId":"mother","time":19,"type":"career","title":"开始工作"},
        {"id":"p0","characterId":"main","time":24,"type":"birth","title":"林澄出生"},
        {"id":"p1","characterId":"main","time":31,"type":"education","title":"第一次转学"},
        {"id":"m2","characterId":"mother","time":38,"type":"family","title":"支持女儿继续读书"},
        {"id":"p2","characterId":"main","time":43,"type":"career","title":"成为工程师"},
        {"id":"p3","characterId":"main","time":49,"type":"relationship","title":"建立新的家庭"},
        {"id":"d0","characterId":"daughter","time":52,"type":"birth","title":"林遥出生"},
        {"id":"d1","characterId":"daughter","time":64,"type":"education","title":"跟随外婆学习"},
        {"id":"m3","characterId":"mother","time":78,"type":"death","title":"林岚离世"},
        {"id":"p4","characterId":"main","time":80,"type":"family","title":"整理母亲留下的手稿"},
        {"id":"p5","characterId":"main","time":88,"type":"death","title":"林澄离世"},
        {"id":"d2","characterId":"daughter","time":91,"type":"career","title":"林遥继续母亲的工程"},
        {"id":"d3","characterId":"daughter","time":105,"type":"death","title":"林遥离世"},
    ]
    return {
        "schemaVersion":"1.0","kind":"life-story","timelineType":"age","primaryCharacterId":"main","tailDuration":3,
        "metadata":{"title":"三代人的潮声","fictional":True,"basis":"ai-fictional-story"},
        "characters":characters,"events":events,
        "relationships":[
            {"id":"r1","relationType":"parent-child","fromId":"mother","toId":"main","segments":[{"fromTime":24,"toTime":78,"status":"close"}],"endReason":"death"},
            {"id":"r2","relationType":"parent-child","fromId":"main","toId":"daughter","segments":[{"fromTime":52,"toTime":88,"status":"close"}],"endReason":"death"},
        ],
    }


class LifeGenerationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def payload(self):
        return {"credentials":{"tavilyApiKey":"","deepseekApiKey":"sk-life-test-key"},"modelId":"deepseek-flash","birthYear":1988,"worldId":"harbor-renewal","worldLabel":"潮港 · 复苏年代"}

    def test_semantic_contract_accepts_consistent_multigeneration_story(self):
        story = validate_generated_life_story(valid_story())
        self.assertEqual(len(story.characters), 3)
        self.assertEqual(story.relationships[1].relationType, "parent-child")

    def test_endpoint_reuses_deepseek_and_returns_only_validated_story(self):
        with patch("server.app.deepseek_json", AsyncMock(return_value=valid_story())) as model:
            response = self.client.post("/api/life/generate", json=self.payload())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["validated"])
        self.assertEqual(response.json()["modelId"], "deepseek-flash")
        self.assertEqual(model.await_count, 1)

    def test_duplicate_event_ids_receive_safe_deterministic_repair(self):
        generated = valid_story()
        generated["events"][1]["id"] = generated["events"][0]["id"]
        repaired, repairs = repair_generated_life_story(generated)
        self.assertNotEqual(repaired["events"][0]["id"], repaired["events"][1]["id"])
        self.assertIn("重复 ID", repairs[0])
        validate_generated_life_story(repaired)

    def test_invalid_first_answer_is_repaired_once(self):
        invalid = valid_story()
        invalid["events"] = invalid["events"][1:]
        model = AsyncMock(side_effect=[invalid, valid_story()])
        with patch("server.app.deepseek_json", model):
            response = self.client.post("/api/life/generate", json=self.payload())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(model.await_count, 2)
        self.assertIn("未通过程序校验", model.await_args_list[1].args[2][-1]["content"])

    def test_two_invalid_answers_fail_without_echoing_key(self):
        invalid = valid_story()
        invalid["relationships"][0]["toId"] = "missing"
        with patch("server.app.deepseek_json", AsyncMock(return_value=invalid)):
            response = self.client.post("/api/life/generate", json=self.payload())
        self.assertEqual(response.status_code, 502)
        self.assertIn("连续两次未通过校验", response.json()["detail"])
        self.assertNotIn("sk-life-test-key", response.text)


if __name__ == "__main__":
    unittest.main()
