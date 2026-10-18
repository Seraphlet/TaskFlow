import hashlib
import hmac
import re


MODEL_PATTERN = re.compile(r"^deepseek-[a-z0-9][a-z0-9._-]*$", re.IGNORECASE)


def validate_model_id(value: str) -> str:
    model_id = (value or "").strip()
    if not 3 <= len(model_id) <= 64 or not MODEL_PATTERN.fullmatch(model_id):
        raise ValueError(
            "模型 ID 必须以 deepseek- 开头，仅包含字母、数字、点、下划线或连字符，长度为 3–64 个字符"
        )
    return model_id


def credential_identity(secret: bytes, tavily_key: str, deepseek_key: str) -> str:
    material = f"tavily\0{tavily_key}\0deepseek\0{deepseek_key}".encode("utf-8")
    return hmac.new(secret, material, hashlib.sha256).hexdigest()


def content_fingerprint(url: str, content: str) -> str:
    return hashlib.sha256(f"{url}\0{content}".encode("utf-8")).hexdigest()


def stable_item_id(url: str, title: str) -> str:
    return "live_" + hashlib.sha256(f"{url}\0{title}".encode("utf-8")).hexdigest()[:20]
