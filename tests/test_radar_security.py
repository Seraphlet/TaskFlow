import unittest

from server.security import credential_identity, content_fingerprint, stable_item_id, validate_model_id


class RadarSecurityTests(unittest.TestCase):
    def test_valid_model_ids(self):
        self.assertEqual(validate_model_id("deepseek-flash"), "deepseek-flash")
        self.assertEqual(validate_model_id("deepseek-v4.1-flash"), "deepseek-v4.1-flash")

    def test_invalid_model_ids(self):
        for value in ("gpt-4", "deepseek bad", "deepseek-/bad", "x" * 65):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_model_id(value)

    def test_identity_does_not_contain_keys_and_is_stable(self):
        first = credential_identity(b"server-secret", "tvly-secret", "sk-secret")
        second = credential_identity(b"server-secret", "tvly-secret", "sk-secret")
        self.assertEqual(first, second)
        self.assertNotIn("tvly-secret", first)
        self.assertNotIn("sk-secret", first)
        self.assertEqual(len(first), 64)

    def test_content_and_item_fingerprints_are_stable(self):
        self.assertEqual(content_fingerprint("https://example.com", "v1"), content_fingerprint("https://example.com", "v1"))
        self.assertTrue(stable_item_id("https://example.com", "Title").startswith("live_"))


if __name__ == "__main__":
    unittest.main()
