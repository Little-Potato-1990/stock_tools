"""Redis-backed cache for ranking endpoints + universe membership.

读路径优先级：Redis (warmup 灌入) → in-memory cached_call → DB SQL。
写：warmup_redis.py 已实现；这里只读，不主动写 Redis。
"""
from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis_async

from app.config import get_settings

_client: redis_async.Redis | None = None


def get_redis() -> redis_async.Redis:
    global _client
    if _client is None:
        _client = redis_async.from_url(
            get_settings().redis_url, decode_responses=True
        )
    return _client


async def get_json(key: str) -> Any | None:
    """Redis 拿 JSON, miss 返 None；任何异常静默返 None（不要因 Redis 挂了拖垮 API）。"""
    try:
        raw = await get_redis().get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def is_in_universe(code: str, universe: str = "default") -> bool | None:
    """检查 code 是否在指定 universe Set 里。Redis miss/异常返 None（=未知，调用方退化用 PG）。"""
    key = "universe:default_active" if universe == "default" else "universe:wide"
    try:
        r = get_redis()
        return bool(await r.sismember(key, code))
    except Exception:
        return None
