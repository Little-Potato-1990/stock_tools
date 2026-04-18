"""Lightweight in-memory cache with singleflight for read-heavy endpoints.

Two key behaviors:
- TTL cache: identical (key) hits within TTL return the previous result instantly.
- Singleflight: while one coroutine is computing for a key, concurrent callers
  with the same key wait on the same future instead of re-running the work.
  This prevents N rapid clicks from launching N expensive SQL pipelines.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable

_CACHE: dict[tuple, tuple[float, Any]] = {}
_INFLIGHT: dict[tuple, asyncio.Future] = {}

DEFAULT_TTL = 90.0


def _get_fresh(key: tuple, ttl: float):
    item = _CACHE.get(key)
    if not item:
        return None
    ts, val = item
    if time.time() - ts > ttl:
        _CACHE.pop(key, None)
        return None
    return val


async def cached_call(
    key: tuple,
    fn: Callable[..., Awaitable[Any]],
    *args,
    ttl: float = DEFAULT_TTL,
    **kwargs,
) -> Any:
    """Run `fn(*args, **kwargs)` deduped by `key`, cache result for `ttl` seconds.

    `args/kwargs` are NOT part of the cache key — callers must encode all
    cache-relevant inputs in `key` themselves. This keeps non-hashable runtime
    objects (e.g. AsyncSession) out of the key.
    """
    cached = _get_fresh(key, ttl)
    if cached is not None:
        return cached

    inflight = _INFLIGHT.get(key)
    if inflight is not None:
        return await inflight

    loop = asyncio.get_event_loop()
    fut: asyncio.Future = loop.create_future()
    _INFLIGHT[key] = fut
    try:
        result = await fn(*args, **kwargs)
        _CACHE[key] = (time.time(), result)
        if not fut.done():
            fut.set_result(result)
        return result
    except Exception as e:
        if not fut.done():
            fut.set_exception(e)
        raise
    finally:
        _INFLIGHT.pop(key, None)


def invalidate(prefix: str | None = None) -> int:
    """Drop all entries (or those whose first key element matches `prefix`)."""
    if prefix is None:
        n = len(_CACHE)
        _CACHE.clear()
        return n
    keys = [k for k in _CACHE if k and k[0] == prefix]
    for k in keys:
        _CACHE.pop(k, None)
    return len(keys)
