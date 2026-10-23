from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from .security import content_fingerprint, credential_identity, stable_item_id, validate_model_id


mimetypes.add_type("image/webp", ".webp")

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("TASKFLOW_RADAR_DATA_DIR", ROOT / "server" / "data"))
DB_PATH = DATA_DIR / "radar.sqlite3"
SECRET_PATH = DATA_DIR / ".identity-secret"
TAVILY_URL = "https://api.tavily.com/search"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search"
TAVILY_CREDIT_COSTS = {"basic": 1, "fast": 1, "ultra-fast": 1, "advanced": 2}
TAVILY_SEARCH_DEPTH = os.getenv("TASKFLOW_TAVILY_SEARCH_DEPTH", "basic").strip().lower()
if TAVILY_SEARCH_DEPTH not in TAVILY_CREDIT_COSTS:
    TAVILY_SEARCH_DEPTH = "basic"
MONTHLY_CREDIT_BUDGET = max(
    1,
    int(os.getenv("TASKFLOW_TAVILY_MONTHLY_CREDIT_BUDGET", os.getenv("TASKFLOW_TAVILY_MONTHLY_BUDGET", "1000"))),
)
CACHE_HOURS = 24
HISTORY_DAYS = 180
INBOX_DAYS = 30
MAX_SEARCHES_PER_EXPLORE = 3
QUOTAS = {"Core Domain": 5, "Adjacent Fields": 2, "Unknown Window": 1}
EXPLORE_LOCKS: dict[str, asyncio.Lock] = {}


class RevalidatingStaticFiles(StaticFiles):
    """Static assets that browsers may reuse after an HTTP revalidation."""

    async def get_response(self, path: str, scope: dict[str, Any]):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        return response


class Credentials(BaseModel):
    tavilyApiKey: str = Field(default="", max_length=512)
    deepseekApiKey: str = Field(min_length=8, max_length=512)


class Profile(BaseModel):
    id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=120)
    coreDomains: list[str] = Field(default_factory=list, max_length=20)
    adjacentDomains: list[str] = Field(default_factory=list, max_length=20)


class ProviderRequest(BaseModel):
    credentials: Credentials
    modelId: str = Field(default="deepseek-flash", min_length=3, max_length=64)


class ExploreRequest(ProviderRequest):
    profile: Profile
    usedItemIds: list[str] = Field(default_factory=list, max_length=2000)


class LifeGenerateRequest(ProviderRequest):
    birthYear: int = Field(default=1988, ge=1900, le=2050)
    worldId: str = Field(default="harbor-renewal", min_length=1, max_length=80)
    worldLabel: str = Field(default="潮港 · 复苏年代", min_length=1, max_length=120)
    direction: str = Field(default="", max_length=300)


class LifeCharacter(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(default="companion", max_length=40)
    birthTime: float = Field(ge=0, le=220)
    endTime: float = Field(ge=0, le=240)
    initialState: dict[str, float] = Field(default_factory=dict)


class LifeEvent(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    characterId: str = Field(min_length=1, max_length=80)
    time: float = Field(ge=0, le=240)
    type: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=900)
    stateChanges: dict[str, float] = Field(default_factory=dict)


class LifeRelationSegment(BaseModel):
    fromTime: float = Field(ge=0, le=240)
    toTime: float = Field(ge=0, le=240)
    status: str = Field(default="close", pattern="^(meeting|close|distant|reconnecting|ended)$")
    eventIds: list[str] = Field(default_factory=list, max_length=12)


class LifeRelationship(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    relationType: str = Field(pattern="^(parent-child|partner|friend|classmate|colleague|acquaintance|caregiver|sibling|relative|other)$")
    fromId: str = Field(min_length=1, max_length=80)
    toId: str = Field(min_length=1, max_length=80)
    segments: list[LifeRelationSegment] = Field(min_length=1, max_length=8)
    endReason: str = Field(default="continues", max_length=80)


class GeneratedLifeStory(BaseModel):
    schemaVersion: str = Field(pattern="^1\\.0$")
    kind: str = Field(pattern="^life-story$")
    timelineType: str = Field(pattern="^age$")
    primaryCharacterId: str
    tailDuration: float = Field(default=3, ge=0, le=10)
    metadata: dict[str, Any]
    characters: list[LifeCharacter] = Field(min_length=3, max_length=8)
    events: list[LifeEvent] = Field(min_length=12, max_length=48)
    relationships: list[LifeRelationship] = Field(min_length=2, max_length=16)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat()


def load_identity_secret() -> bytes:
    configured = os.getenv("TASKFLOW_IDENTITY_SECRET", "").strip()
    if configured:
        return configured.encode("utf-8")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if SECRET_PATH.exists():
        return SECRET_PATH.read_bytes()
    value = secrets.token_bytes(32)
    SECRET_PATH.write_bytes(value)
    return value


IDENTITY_SECRET = load_identity_secret()


def connect_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS monthly_usage (
          identity TEXT NOT NULL, month TEXT NOT NULL, searches INTEGER NOT NULL DEFAULT 0,
          credits INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (identity, month)
        );
        CREATE TABLE IF NOT EXISTS search_cache (
          identity TEXT NOT NULL, query_hash TEXT NOT NULL, payload TEXT NOT NULL, expires_at TEXT NOT NULL,
          PRIMARY KEY (identity, query_hash)
        );
        CREATE TABLE IF NOT EXISTS recommendation_history (
          identity TEXT NOT NULL, url TEXT NOT NULL, content_hash TEXT NOT NULL, recommended_at TEXT NOT NULL,
          PRIMARY KEY (identity, url)
        );
        CREATE TABLE IF NOT EXISTS inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT NOT NULL, profile_id TEXT NOT NULL,
          payload TEXT NOT NULL, created_at TEXT NOT NULL
        );
        """
    )
    usage_columns = {row[1] for row in db.execute("PRAGMA table_info(monthly_usage)").fetchall()}
    if "credits" not in usage_columns:
        db.execute("ALTER TABLE monthly_usage ADD COLUMN credits INTEGER NOT NULL DEFAULT 0")
        # Every historical request used advanced depth, so the conservative
        # migration is two credits for each previously recorded request.
        db.execute("UPDATE monthly_usage SET credits=searches*2 WHERE credits=0 AND searches>0")
        db.commit()
    return db


def cleanup(db: sqlite3.Connection) -> None:
    db.execute("DELETE FROM search_cache WHERE expires_at < ?", (iso(),))
    db.execute("DELETE FROM recommendation_history WHERE recommended_at < ?", (iso(utc_now() - timedelta(days=HISTORY_DAYS)),))
    db.execute("DELETE FROM inbox WHERE created_at < ?", (iso(utc_now() - timedelta(days=INBOX_DAYS)),))
    db.commit()


def reserve_credits(db: sqlite3.Connection, identity: str, credit_cost: int) -> int:
    month = utc_now().strftime("%Y-%m")
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT credits FROM monthly_usage WHERE identity=? AND month=?", (identity, month)).fetchone()
        used = int(row["credits"]) if row else 0
        if used + credit_cost > MONTHLY_CREDIT_BUDGET:
            db.rollback()
            raise HTTPException(429, f"Tavily 月度预算不足：已预留 {used} / {MONTHLY_CREDIT_BUDGET} credits，本次需要 {credit_cost} credits")
        db.execute(
            "INSERT INTO monthly_usage(identity, month, searches, credits) VALUES(?,?,1,?) "
            "ON CONFLICT(identity, month) DO UPDATE SET searches=searches+1, credits=credits+excluded.credits",
            (identity, month, credit_cost),
        )
        db.commit()
        return used + credit_cost
    except HTTPException:
        raise
    except sqlite3.Error as exc:
        db.rollback()
        raise HTTPException(503, "无法更新 Tavily credits 预算，请稍后重试") from exc


def settle_credits(db: sqlite3.Connection, identity: str, reserved: int, confirmed: int) -> None:
    difference = confirmed - reserved
    if not difference:
        return
    month = utc_now().strftime("%Y-%m")
    db.execute(
        "UPDATE monthly_usage SET credits=MAX(0, credits+?) WHERE identity=? AND month=?",
        (difference, identity, month),
    )
    db.commit()


def empty_search_usage() -> dict[str, Any]:
    return {
        "tavilyRequests": 0,
        "tavilyCredits": 0,
        "deepseekSearchRequests": 0,
        "cacheHits": 0,
        "tavilyDepth": TAVILY_SEARCH_DEPTH,
        "tavilyCreditBudget": MONTHLY_CREDIT_BUDGET,
        "accounting": "confirmed",
    }


def merge_search_usage(target: dict[str, Any], incoming: dict[str, Any]) -> None:
    for key in ("tavilyRequests", "tavilyCredits", "deepseekSearchRequests", "cacheHits"):
        target[key] = int(target.get(key, 0)) + int(incoming.get(key, 0))
    if incoming.get("accounting") == "reserved":
        target["accounting"] = "reserved"
    if incoming.get("tavilyBudgetExhausted"):
        target["tavilyBudgetExhausted"] = True


def query_hash(query: str) -> str:
    import hashlib

    return hashlib.sha256(query.encode("utf-8")).hexdigest()


async def deepseek_search(api_key: str, query: str) -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                DEEPSEEK_SEARCH_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"query": query.strip()[:128], "count": 8, "need_content": True},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, "DeepSeek Search 无法连接，请检查网络后重试") from exc
    if response.status_code in (401, 403):
        raise HTTPException(400, "DeepSeek API Key 无效或无权使用联网搜索")
    if not response.is_success:
        raise HTTPException(502, f"DeepSeek Search 请求失败（HTTP {response.status_code}）")
    try:
        body = response.json()
        return [
            {
                "title": str(item.get("title", ""))[:300],
                "url": str(item.get("url", ""))[:2000],
                "content": str(item.get("content") or item.get("summary") or item.get("snippet") or "")[:5000],
                "_searchProvider": "DeepSeek Search",
            }
            for item in body.get("results", [])
            if item.get("url")
        ]
    except (ValueError, TypeError) as exc:
        raise HTTPException(502, "DeepSeek Search 返回了无法解析的数据") from exc


async def tavily_search(
    db: sqlite3.Connection,
    identity: str,
    api_key: str,
    query: str,
    fallback_api_key: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    usage = empty_search_usage()
    cache_provider = f"tavily:{TAVILY_SEARCH_DEPTH}" if api_key.strip() else "deepseek-search"
    cache_key = query_hash(f"{cache_provider}\0{query}")
    cached = db.execute(
        "SELECT payload FROM search_cache WHERE identity=? AND query_hash=? AND expires_at>?",
        (identity, cache_key, iso()),
    ).fetchone()
    if cached:
        usage["cacheHits"] = 1
        return json.loads(cached["payload"]), usage

    if not api_key.strip():
        if not fallback_api_key:
            raise HTTPException(400, "未配置 Tavily，且缺少可用于联网搜索的 DeepSeek API Key")
        results = await deepseek_search(fallback_api_key, query)
        usage["deepseekSearchRequests"] = 1
        db.execute(
            "INSERT OR REPLACE INTO search_cache(identity, query_hash, payload, expires_at) VALUES(?,?,?,?)",
            (identity, cache_key, json.dumps(results, ensure_ascii=False), iso(utc_now() + timedelta(hours=CACHE_HOURS))),
        )
        db.commit()
        return results, usage

    reserved = TAVILY_CREDIT_COSTS[TAVILY_SEARCH_DEPTH]
    try:
        reserve_credits(db, identity, reserved)
    except HTTPException as exc:
        if exc.status_code != 429 or not fallback_api_key:
            raise
        results = await deepseek_search(fallback_api_key, query)
        usage["deepseekSearchRequests"] = 1
        usage["tavilyBudgetExhausted"] = True
        db.execute(
            "INSERT OR REPLACE INTO search_cache(identity, query_hash, payload, expires_at) VALUES(?,?,?,?)",
            (identity, cache_key, json.dumps(results, ensure_ascii=False), iso(utc_now() + timedelta(hours=CACHE_HOURS))),
        )
        db.commit()
        return results, usage
    usage["tavilyRequests"] = 1
    usage["tavilyCredits"] = reserved
    usage["accounting"] = "reserved"
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                TAVILY_URL,
                json={"api_key": api_key, "query": query, "search_depth": TAVILY_SEARCH_DEPTH, "max_results": 8, "include_answer": False, "include_usage": True},
            )
    except httpx.RequestError as exc:
        if not fallback_api_key:
            raise HTTPException(502, "无法连接 Tavily，请检查网络后重试") from exc
        results = await deepseek_search(fallback_api_key, query)
        usage["deepseekSearchRequests"] = 1
        response = None
    if response is not None and response.status_code in (401, 403):
        raise HTTPException(400, "Tavily API Key 无效或无权限")
    if response is not None and not response.is_success:
        if fallback_api_key and (response.status_code == 429 or response.status_code >= 500):
            results = await deepseek_search(fallback_api_key, query)
            usage["deepseekSearchRequests"] = 1
        else:
            raise HTTPException(502, f"Tavily 请求失败（HTTP {response.status_code}）")
    if response is not None and response.is_success:
        try:
            body = response.json()
            confirmed = int(body.get("usage", {}).get("credits", reserved))
            if confirmed >= 0:
                settle_credits(db, identity, reserved, confirmed)
                usage["tavilyCredits"] = confirmed
                usage["accounting"] = "confirmed"
            results = [
                {
                    "title": str(item.get("title", ""))[:300],
                    "url": str(item.get("url", ""))[:2000],
                    "content": str(item.get("content", ""))[:5000],
                    "_searchProvider": "Tavily",
                }
                for item in body.get("results", [])
                if item.get("url")
            ]
        except (ValueError, TypeError) as exc:
            if not fallback_api_key:
                raise HTTPException(502, "Tavily 返回了无法解析的数据") from exc
            results = await deepseek_search(fallback_api_key, query)
            usage["deepseekSearchRequests"] = 1
    db.execute(
        "INSERT OR REPLACE INTO search_cache(identity, query_hash, payload, expires_at) VALUES(?,?,?,?)",
        (identity, cache_key, json.dumps(results, ensure_ascii=False), iso(utc_now() + timedelta(hours=CACHE_HOURS))),
    )
    db.commit()
    return results, usage


def parse_deepseek_json(content: Any, finish_reason: Any = None) -> dict[str, Any]:
    if finish_reason == "length":
        raise ValueError("DeepSeek 输出达到长度上限，JSON 被截断")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("DeepSeek 返回了空内容")

    text = content.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline >= 0:
            text = text[first_newline + 1 :]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3].rstrip()

    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("DeepSeek 返回内容中没有完整的 JSON 对象")


async def deepseek_json(api_key: str, model_id: str, messages: list[dict[str, str]], max_tokens: int = 6000) -> dict[str, Any]:
    response: httpx.Response | None = None
    last_error: httpx.RequestError | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    DEEPSEEK_URL,
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": model_id,
                        "messages": messages,
                        "thinking": {"type": "disabled"},
                        "temperature": 0.25,
                        "max_tokens": max_tokens,
                        "response_format": {"type": "json_object"},
                    },
                )
            break
        except httpx.RequestError as exc:
            last_error = exc
            if attempt == 0:
                await asyncio.sleep(0.5)
    if response is None:
        raise HTTPException(502, "无法连接 DeepSeek，请检查网络后重试") from last_error
    if response.status_code in (401, 403):
        raise HTTPException(400, "DeepSeek API Key 无效或无权限")
    if response.status_code in (400, 404):
        supported = "deepseek-flash、deepseek-v4-pro"
        raise HTTPException(400, f"DeepSeek 模型不可用或请求不受支持：{model_id}。当前接口可尝试：{supported}")
    if not response.is_success:
        raise HTTPException(502, f"DeepSeek 请求失败（HTTP {response.status_code}）")
    try:
        body = response.json()
        choice = body["choices"][0]
        return parse_deepseek_json(choice["message"]["content"], choice.get("finish_reason"))
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "DeepSeek 响应结构异常，未找到可解析内容") from exc
    except ValueError as exc:
        raise HTTPException(502, str(exc)) from exc


def validate_generated_life_story(value: dict[str, Any]) -> GeneratedLifeStory:
    """Validate model output before it can reach the browser or Canvas."""
    story = GeneratedLifeStory.model_validate(value)
    errors: list[str] = []
    characters = {character.id: character for character in story.characters}
    if len(characters) != len(story.characters):
        errors.append("人物 ID 必须唯一")
    if story.primaryCharacterId not in characters:
        errors.append("primaryCharacterId 必须引用现有人物")
    event_ids: set[str] = set()
    deaths: dict[str, float] = {}
    births: dict[str, list[float]] = {character_id: [] for character_id in characters}
    state_keys = {"health", "resources", "mood", "education", "stability"}
    for event in story.events:
        if event.id in event_ids:
            errors.append(f"事件 ID 重复：{event.id}")
        event_ids.add(event.id)
        character = characters.get(event.characterId)
        if not character:
            errors.append(f"事件 {event.id} 引用了不存在的人物")
            continue
        if event.time < character.birthTime or event.time > character.endTime:
            errors.append(f"事件 {event.id} 超出 {character.name} 的生命时间线")
        if event.type == "birth":
            births[event.characterId].append(event.time)
        if event.type == "death":
            if event.characterId in deaths:
                errors.append(f"{character.name} 只能有一个死亡事件")
            deaths[event.characterId] = event.time
        for key, number in event.stateChanges.items():
            if key not in state_keys or not -1 <= number <= 1:
                errors.append(f"事件 {event.id} 的状态变化无效")
    for character_id, character in characters.items():
        birth_times = births[character_id]
        if len(birth_times) != 1 or abs(birth_times[0] - character.birthTime) > .001:
            errors.append(f"{character.name} 必须有且仅有一个与 birthTime 一致的出生事件")
        death_time = deaths.get(character_id)
        if death_time is not None:
            if abs(death_time - character.endTime) > .001:
                errors.append(f"{character.name} 的死亡事件必须与 endTime 一致")
            if any(event.characterId == character_id and event.time > death_time for event in story.events):
                errors.append(f"{character.name} 的死亡事件之后不能再有事件")
        for key, number in character.initialState.items():
            if key not in state_keys or not 0 <= number <= 1:
                errors.append(f"{character.name} 的初始状态无效")
        independent_events = [event for event in story.events if event.characterId == character_id and event.type not in {"birth", "death"}]
        if character.endTime - character.birthTime >= 8 and not independent_events:
            errors.append(f"{character.name} 需要至少一个属于自己的独立人生事件")
    relation_ids: set[str] = set()
    for relation in story.relationships:
        if relation.id in relation_ids:
            errors.append(f"关系 ID 重复：{relation.id}")
        relation_ids.add(relation.id)
        if relation.fromId == relation.toId or relation.fromId not in characters or relation.toId not in characters:
            errors.append(f"关系 {relation.id} 的人物引用无效")
            continue
        earliest = max(characters[relation.fromId].birthTime, characters[relation.toId].birthTime)
        latest = min(characters[relation.fromId].endTime, characters[relation.toId].endTime)
        if relation.relationType == "parent-child":
            generation_gap = characters[relation.toId].birthTime - characters[relation.fromId].birthTime
            if generation_gap < 14 or generation_gap > 65:
                errors.append(f"亲子关系 {relation.id} 必须按 fromId=父母、toId=子女记录，出生时间需相差 14–65 年")
        previous_end = -1.0
        for segment in relation.segments:
            if segment.fromTime > segment.toTime or segment.fromTime < earliest or segment.toTime > latest:
                errors.append(f"关系 {relation.id} 的时间段超出双方生命时间线")
            if segment.fromTime < previous_end:
                errors.append(f"关系 {relation.id} 的时间段必须按顺序且不能重叠")
            previous_end = segment.toTime
            for event_id in segment.eventIds:
                if event_id not in event_ids:
                    errors.append(f"关系 {relation.id} 引用了不存在的事件 {event_id}")
    if not any(relation.relationType in {"parent-child", "caregiver"} for relation in story.relationships):
        errors.append("故事至少需要一段父母或照护关系")
    if errors:
        raise ValueError("；".join(errors[:10]))
    return story


def repair_generated_life_story(value: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Apply only deterministic repairs that cannot change story meaning."""
    repaired = json.loads(json.dumps(value))
    repairs: list[str] = []
    for collection_name in ("events", "relationships"):
        seen: dict[str, int] = {}
        for item in repaired.get(collection_name, []) if isinstance(repaired, dict) else []:
            original = str(item.get("id", "")).strip()
            if not original:
                continue
            count = seen.get(original, 0)
            seen[original] = count + 1
            if count:
                item["id"] = f"{original}-{count + 1}"
                repairs.append(f"{collection_name} 中的重复 ID {original} 已安全改为 {item['id']}")
    characters = repaired.get("characters", []) if isinstance(repaired, dict) else []
    events = repaired.get("events", []) if isinstance(repaired, dict) else []
    if isinstance(characters, list) and isinstance(events, list):
        used_ids = {str(event.get("id", "")) for event in events if isinstance(event, dict)}
        birth_ids = {
            str(event.get("characterId", ""))
            for event in events
            if isinstance(event, dict) and event.get("type") == "birth"
        }
        for character in characters:
            if not isinstance(character, dict) or character.get("id") in birth_ids or "birthTime" not in character:
                continue
            character_id = str(character.get("id", ""))
            event_id = f"birth-{character_id}"
            suffix = 2
            while event_id in used_ids:
                event_id = f"birth-{character_id}-{suffix}"
                suffix += 1
            used_ids.add(event_id)
            events.append({
                "id": event_id,
                "characterId": character_id,
                "time": character["birthTime"],
                "type": "birth",
                "title": f"{character.get('name', character_id)}出生",
                "description": "这条生命线从共同世界时间中的这一刻开始。",
                "stateChanges": {},
            })
            repairs.append(f"为 {character.get('name', character_id)} 补入与 birthTime 一致的出生事件")
        events.sort(key=lambda event: (float(event.get("time", 0)), str(event.get("id", ""))))
    return repaired, repairs


def search_queries(profile: Profile) -> list[tuple[str, str]]:
    core = ", ".join(profile.coreDomains[:8]) or profile.name
    adjacent = ", ".join(profile.adjacentDomains[:8]) or f"{profile.name} adjacent fields"
    return [
        ("Core Domain", f"latest useful developments and practical insights in {core}"),
        ("Adjacent Fields", f"new cross-disciplinary ideas connecting {core} with {adjacent}"),
        ("Unknown Window", f"surprising emerging ideas outside {core} worth learning now"),
    ][:MAX_SEARCHES_PER_EXPLORE]


def prepare_candidates(db: sqlite3.Connection, identity: str, section: str, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared = []
    for result in results:
        fingerprint = content_fingerprint(result["url"], result["content"])
        previous = db.execute(
            "SELECT content_hash FROM recommendation_history WHERE identity=? AND url=?",
            (identity, result["url"]),
        ).fetchone()
        if previous and previous["content_hash"] == fingerprint:
            continue
        prepared.append({**result, "section": section, "contentHash": fingerprint, "isUpdate": bool(previous)})
    return prepared


def normalize_items(raw: Any, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_url = {item["url"]: item for item in candidates}
    counts = {name: 0 for name in QUOTAS}
    normalized: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return normalized
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = str(item.get("sourceUrl", ""))
        candidate = by_url.get(url)
        section = str(item.get("section", ""))
        if not candidate or section not in QUOTAS or counts[section] >= QUOTAS[section]:
            continue
        change_summary = str(item.get("changeSummary", "")).strip()
        if candidate["isUpdate"] and not change_summary:
            continue
        normalized.append(
            {
                "id": stable_item_id(url, str(item.get("title", ""))),
                "section": section,
                "title": str(item.get("title", ""))[:180],
                "domain": str(item.get("domain", "Learning"))[:80],
                "explanation": str(item.get("explanation", ""))[:900],
                "why": str(item.get("why", ""))[:700],
                "sourceName": str(item.get("sourceName", "Web"))[:120],
                "sourceUrl": url,
                "provider": f"{candidate.get('_searchProvider', 'Tavily')} + DeepSeek",
                **({"changeSummary": change_summary[:500]} if change_summary else {}),
                "_contentHash": candidate["contentHash"],
            }
        )
        counts[section] += 1
    return normalized


def recover_unreceived_batch(
    db: sqlite3.Connection,
    identity: str,
    profile_id: str,
    model_id: str,
    used_item_ids: list[str],
) -> dict[str, Any] | None:
    used = set(used_item_ids)
    rows = db.execute(
        "SELECT payload FROM inbox WHERE identity=? AND profile_id=? ORDER BY id DESC LIMIT 5",
        (identity, profile_id),
    ).fetchall()
    for row in rows:
        try:
            payload = json.loads(row["payload"])
            if payload.get("modelId") != model_id:
                continue
            unseen = [item for item in payload.get("items", []) if item.get("id") not in used]
            if not unseen:
                continue
            counts = {section: len([item for item in unseen if item.get("section") == section]) for section in QUOTAS}
            return {
                **payload,
                "items": unseen,
                "shortages": {section: max(0, quota - counts[section]) for section, quota in QUOTAS.items()},
                "exhausted": False,
                "replayed": True,
            }
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return None


app = FastAPI(title="TaskFlow Radar API", version="0.2.0", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4173", "http://127.0.0.1:4173", "http://localhost:8788", "http://127.0.0.1:8788"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Any, _exc: RequestValidationError) -> JSONResponse:
    # FastAPI's default validation payload includes rejected input values. A
    # generic response prevents malformed credential fields from being echoed.
    return JSONResponse(status_code=422, content={"detail": "请求结构无效，请检查凭证、模型 ID 和 Profile 字段"})


@app.get("/api/radar/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "DeepSeek", "modelBase": "fixed"}


@app.post("/api/radar/test")
async def test_connection(request: ProviderRequest) -> dict[str, Any]:
    try:
        model_id = validate_model_id(request.modelId)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    await deepseek_json(
        request.credentials.deepseekApiKey,
        model_id,
        [{"role": "system", "content": "Return JSON only."}, {"role": "user", "content": '{"ok":true}'}],
        max_tokens=128,
    )
    tavily_configured = bool(request.credentials.tavilyApiKey.strip())
    return {
        "ok": True,
        "provider": "DeepSeek",
        "modelId": model_id,
        "searchMode": "Tavily preferred" if tavily_configured else "DeepSeek Search",
        "tavily": {"configured": tavily_configured, "tested": False},
        "note": "连接测试不会调用搜索接口或消耗搜索 credits；Tavily 将在首次探索时验证。",
    }


@app.post("/api/life/generate")
async def generate_life(request: LifeGenerateRequest) -> dict[str, Any]:
    try:
        model_id = validate_model_id(request.modelId)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    specification = {
        "birthYear": request.birthYear,
        "world": {"id": request.worldId, "label": request.worldLabel},
        "direction": request.direction or "自然、克制、有因果连续性的一生",
        "contract": {
            "schemaVersion": "1.0", "kind": "life-story", "timelineType": "age",
            "primaryCharacterId": "characters 中一个人物的 id", "tailDuration": 3,
            "metadata": {"title": "故事标题", "fictional": True, "basis": "ai-fictional-story"},
            "characters": [{"id": "唯一 id", "name": "姓名", "role": "primary/parent/partner/child/friend", "birthTime": 20, "endTime": 90, "initialState": {"health": .7, "resources": .5, "mood": .6, "education": .1, "stability": .6}}],
            "events": [{"id": "唯一 id", "characterId": "人物 id", "time": 0, "type": "birth/education/career/relationship/family/migration/health/death", "title": "标题", "description": "原因、选择或影响", "stateChanges": {"mood": .05}}],
            "relationships": [{"id": "唯一 id", "relationType": "parent-child/partner/friend/classmate/colleague/acquaintance/caregiver/sibling/relative/other", "fromId": "人物 id", "toId": "人物 id", "segments": [{"fromTime": 0, "toTime": 30, "status": "meeting/close/distant/reconnecting/ended", "eventIds": ["关联事件 id"]}], "endReason": "continues/separation/death"}],
        },
        "rules": [
            "只返回一个 JSON 对象，不使用 Markdown。",
            "生成 4–7 个可独立展示的人物和 20–35 个有叙事作用的事件；所有时间使用同一世界时间轴，时间 0 可以是父母出生，主角不必在时间 0 出生。每个人都必须有不依附主角的独立事件。",
            "每个人必须有且仅有一个 birth 事件，time 必须等于 birthTime；若人物死亡，death time 必须等于 endTime，死亡后不得有其事件。",
            "先建立人物与关系，再写事件。提到女儿、儿子、伴侣或父母且需要独立展示时，必须创建人物对象和关系。",
            "至少包含父母或照护者；伴侣、婚育和长寿均不强制。parent-child 必须 fromId=父母、toId=子女，出生时间相差 14–65 年；关系从子女出生后开始。",
            "让重要事件影响后续选择，并让配角拥有不依附主角的经历；不要用散步或休息一天填充时间线。",
            "relation segments 必须位于双方出生与 endTime 的交集内，并按时间排序、不重叠；用 meeting、close、distant、reconnecting、ended 表达相遇、陪伴、疏远、重联与终止，并用 eventIds 关联造成变化的事件。",
            "stateChanges 只能使用 health/resources/mood/education/stability，初始值为 0–1，变化值为 -1–1。",
            "内容为虚构故事，不冒充真实史实，不输出 Canvas 坐标或 annualStates。",
        ],
    }
    messages = [
        {"role": "system", "content": "你是结构化人生故事编辑。严格遵守数据契约，返回合法 JSON；先保证人物、关系、出生、死亡和事件时间一致。"},
        {"role": "user", "content": json.dumps(specification, ensure_ascii=False)},
    ]
    last_problem = "模型输出未通过校验"
    applied_repairs: list[str] = []
    for attempt in range(2):
        generated = await deepseek_json(request.credentials.deepseekApiKey, model_id, messages, max_tokens=9000)
        generated, repairs = repair_generated_life_story(generated)
        applied_repairs.extend(repairs)
        try:
            story = validate_generated_life_story(generated)
            return {"story": story.model_dump(), "provider": "DeepSeek", "modelId": model_id, "validated": True, "repairs": applied_repairs}
        except (ValidationError, ValueError) as exc:
            if isinstance(exc, ValidationError):
                last_problem = "；".join(f"{'.'.join(map(str, error['loc']))}：{error['msg']}" for error in exc.errors()[:10])
            else:
                last_problem = str(exc)
            if attempt == 0:
                messages.extend([
                    {"role": "assistant", "content": json.dumps(generated, ensure_ascii=False)},
                    {"role": "user", "content": f"上一个 JSON 未通过程序校验：{last_problem}。请完整重写并只返回修复后的 JSON。"},
                ])
    raise HTTPException(502, f"DeepSeek 人生故事连续两次未通过校验：{last_problem[:500]}")


@app.post("/api/radar/explore")
async def explore(request: ExploreRequest) -> dict[str, Any]:
    try:
        model_id = validate_model_id(request.modelId)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    identity = credential_identity(IDENTITY_SECRET, request.credentials.tavilyApiKey, request.credentials.deepseekApiKey)
    lock = EXPLORE_LOCKS.setdefault(identity, asyncio.Lock())
    if lock.locked():
        raise HTTPException(409, "当前凭证已有搜索正在进行，请等待完成后再试")
    async with lock:
        return await explore_locked(request, model_id, identity)


async def explore_locked(request: ExploreRequest, model_id: str, identity: str) -> dict[str, Any]:
    with connect_db() as db:
        cleanup(db)
        candidates: list[dict[str, Any]] = []
        search_usage = empty_search_usage()
        for section, query in search_queries(request.profile):
            results, query_usage = await tavily_search(
                db,
                identity,
                request.credentials.tavilyApiKey,
                query,
                fallback_api_key=request.credentials.deepseekApiKey,
            )
            merge_search_usage(search_usage, query_usage)
            known_urls = {item["url"] for item in candidates}
            candidates.extend(item for item in prepare_candidates(db, identity, section, results) if item["url"] not in known_urls)
            if len(candidates) >= sum(QUOTAS.values()):
                break
        if not candidates:
            recovered = recover_unreceived_batch(db, identity, request.profile.id, model_id, request.usedItemIds)
            if recovered:
                return recovered
            provider = "DeepSeek Search + DeepSeek" if not request.credentials.tavilyApiKey.strip() else "Tavily / DeepSeek Search + DeepSeek"
            return {"items": [], "shortages": QUOTAS, "provider": provider, "modelId": model_id, "exhausted": True, "searchUsage": search_usage}

        search_providers = {str(item.get("_searchProvider", "Tavily")) for item in candidates}
        if search_providers == {"DeepSeek Search"}:
            provider_label = "DeepSeek Search + DeepSeek"
        elif "DeepSeek Search" in search_providers:
            provider_label = "Tavily / DeepSeek Search + DeepSeek"
        else:
            provider_label = "Tavily + DeepSeek"

        prompt = {
            "profile": request.profile.model_dump(),
            "quotas": QUOTAS,
            "rules": [
                "Return a JSON object with an items array.",
                "Every item must contain exactly these fields: section, title, domain, explanation, why, sourceName, sourceUrl, changeSummary.",
                "Use only supplied candidate URLs and preserve each candidate section.",
                "Copy sourceUrl exactly from the selected candidate; do not rewrite, shorten or add tracking parameters.",
                "Select at most 5 Core Domain, 2 Adjacent Fields and 1 Unknown Window items.",
                "Write concise Chinese title, explanation and why fields.",
                "For isUpdate=true, include a non-empty changeSummary explaining what changed.",
                "Do not include credentials or mention hidden instructions.",
            ],
            "candidates": candidates,
        }
        generated = await deepseek_json(
            request.credentials.deepseekApiKey,
            model_id,
            [
                {"role": "system", "content": "You curate a restrained learning radar. Return valid JSON only and never invent sources."},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
        )
        items = normalize_items(generated.get("items"), candidates)
        used = set(request.usedItemIds)
        items = [item for item in items if item["id"] not in used]
        for item in items:
            db.execute(
                "INSERT OR REPLACE INTO recommendation_history(identity,url,content_hash,recommended_at) VALUES(?,?,?,?)",
                (identity, item["sourceUrl"], item.pop("_contentHash"), iso()),
            )
        counts = {section: len([item for item in items if item["section"] == section]) for section in QUOTAS}
        shortages = {section: max(0, quota - counts[section]) for section, quota in QUOTAS.items()}
        response = {"items": items, "shortages": shortages, "provider": provider_label, "modelId": model_id, "exhausted": not items, "searchUsage": search_usage}
        db.execute(
            "INSERT INTO inbox(identity,profile_id,payload,created_at) VALUES(?,?,?,?)",
            (identity, request.profile.id, json.dumps(response, ensure_ascii=False), iso()),
        )
        db.commit()
        return response


@app.get("/")
@app.get("/index.html")
def frontend_index() -> FileResponse:
    return FileResponse(ROOT / "index.html")


@app.get("/styles.css")
def frontend_styles() -> FileResponse:
    return FileResponse(ROOT / "styles.css", media_type="text/css")


app.mount("/js", StaticFiles(directory=ROOT / "js"), name="javascript")
app.mount("/images", RevalidatingStaticFiles(directory=ROOT / "images"), name="images")
