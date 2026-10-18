from __future__ import annotations

import json
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
from pydantic import BaseModel, Field

from .security import content_fingerprint, credential_identity, stable_item_id, validate_model_id


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("TASKFLOW_RADAR_DATA_DIR", ROOT / "server" / "data"))
DB_PATH = DATA_DIR / "radar.sqlite3"
SECRET_PATH = DATA_DIR / ".identity-secret"
TAVILY_URL = "https://api.tavily.com/search"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
MONTHLY_BUDGET = max(1, int(os.getenv("TASKFLOW_TAVILY_MONTHLY_BUDGET", "1000")))
CACHE_HOURS = 24
HISTORY_DAYS = 180
INBOX_DAYS = 30
MAX_SEARCHES_PER_EXPLORE = 3
QUOTAS = {"Core Domain": 5, "Adjacent Fields": 2, "Unknown Window": 1}


class Credentials(BaseModel):
    tavilyApiKey: str = Field(min_length=8, max_length=512)
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
    return db


def cleanup(db: sqlite3.Connection) -> None:
    db.execute("DELETE FROM search_cache WHERE expires_at < ?", (iso(),))
    db.execute("DELETE FROM recommendation_history WHERE recommended_at < ?", (iso(utc_now() - timedelta(days=HISTORY_DAYS)),))
    db.execute("DELETE FROM inbox WHERE created_at < ?", (iso(utc_now() - timedelta(days=INBOX_DAYS)),))
    db.commit()


def reserve_search(db: sqlite3.Connection, identity: str) -> int:
    month = utc_now().strftime("%Y-%m")
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT searches FROM monthly_usage WHERE identity=? AND month=?", (identity, month)).fetchone()
        used = int(row["searches"]) if row else 0
        if used >= MONTHLY_BUDGET:
            db.rollback()
            raise HTTPException(429, f"Tavily 月度搜索预算已用尽（{MONTHLY_BUDGET} 次）")
        db.execute(
            "INSERT INTO monthly_usage(identity, month, searches) VALUES(?,?,1) "
            "ON CONFLICT(identity, month) DO UPDATE SET searches=searches+1",
            (identity, month),
        )
        db.commit()
        return used + 1
    except HTTPException:
        raise
    except sqlite3.Error as exc:
        db.rollback()
        raise HTTPException(503, "无法更新 Tavily 搜索预算，请稍后重试") from exc


def query_hash(query: str) -> str:
    import hashlib

    return hashlib.sha256(query.encode("utf-8")).hexdigest()


async def tavily_search(db: sqlite3.Connection, identity: str, api_key: str, query: str) -> list[dict[str, Any]]:
    cache_key = query_hash(query)
    cached = db.execute(
        "SELECT payload FROM search_cache WHERE identity=? AND query_hash=? AND expires_at>?",
        (identity, cache_key, iso()),
    ).fetchone()
    if cached:
        return json.loads(cached["payload"])

    reserve_search(db, identity)
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.post(
                TAVILY_URL,
                json={"api_key": api_key, "query": query, "search_depth": "advanced", "max_results": 8, "include_answer": False},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, "无法连接 Tavily，请检查网络后重试") from exc
    if response.status_code in (401, 403):
        raise HTTPException(400, "Tavily API Key 无效或无权限")
    if not response.is_success:
        raise HTTPException(502, f"Tavily 请求失败（HTTP {response.status_code}）")
    try:
        body = response.json()
        results = [
            {"title": str(item.get("title", ""))[:300], "url": str(item.get("url", ""))[:2000], "content": str(item.get("content", ""))[:5000]}
            for item in body.get("results", []) if item.get("url")
        ]
    except (ValueError, TypeError) as exc:
        raise HTTPException(502, "Tavily 返回了无法解析的数据") from exc
    db.execute(
        "INSERT OR REPLACE INTO search_cache(identity, query_hash, payload, expires_at) VALUES(?,?,?,?)",
        (identity, cache_key, json.dumps(results, ensure_ascii=False), iso(utc_now() + timedelta(hours=CACHE_HOURS))),
    )
    db.commit()
    return results


async def deepseek_json(api_key: str, model_id: str, messages: list[dict[str, str]], max_tokens: int = 3500) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                DEEPSEEK_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model_id, "messages": messages, "temperature": 0.25, "max_tokens": max_tokens, "response_format": {"type": "json_object"}},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, "无法连接 DeepSeek，请检查网络后重试") from exc
    if response.status_code in (401, 403):
        raise HTTPException(400, "DeepSeek API Key 无效或无权限")
    if response.status_code in (400, 404):
        raise HTTPException(400, f"DeepSeek 模型不可用或请求不受支持：{model_id}")
    if not response.is_success:
        raise HTTPException(502, f"DeepSeek 请求失败（HTTP {response.status_code}）")
    try:
        content = response.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
        return parsed
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "DeepSeek 返回了无法解析的 JSON") from exc


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
                "provider": "Tavily + DeepSeek",
                **({"changeSummary": change_summary[:500]} if change_summary else {}),
                "_contentHash": candidate["contentHash"],
            }
        )
        counts[section] += 1
    return normalized


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
    identity = credential_identity(IDENTITY_SECRET, request.credentials.tavilyApiKey, request.credentials.deepseekApiKey)
    with connect_db() as db:
        cleanup(db)
        await tavily_search(db, identity, request.credentials.tavilyApiKey, "TaskFlow connection test")
    await deepseek_json(
        request.credentials.deepseekApiKey,
        model_id,
        [{"role": "system", "content": "Return JSON only."}, {"role": "user", "content": '{"ok":true}'}],
        max_tokens=32,
    )
    return {"ok": True, "provider": "DeepSeek", "modelId": model_id}


@app.post("/api/radar/explore")
async def explore(request: ExploreRequest) -> dict[str, Any]:
    try:
        model_id = validate_model_id(request.modelId)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    identity = credential_identity(IDENTITY_SECRET, request.credentials.tavilyApiKey, request.credentials.deepseekApiKey)
    with connect_db() as db:
        cleanup(db)
        candidates: list[dict[str, Any]] = []
        for section, query in search_queries(request.profile):
            results = await tavily_search(db, identity, request.credentials.tavilyApiKey, query)
            candidates.extend(prepare_candidates(db, identity, section, results))
        if not candidates:
            return {"items": [], "shortages": QUOTAS, "provider": "Tavily + DeepSeek", "modelId": model_id, "exhausted": True}

        prompt = {
            "profile": request.profile.model_dump(),
            "quotas": QUOTAS,
            "rules": [
                "Return a JSON object with an items array.",
                "Use only supplied candidate URLs and preserve each candidate section.",
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
        response = {"items": items, "shortages": shortages, "provider": "Tavily + DeepSeek", "modelId": model_id, "exhausted": not items}
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
