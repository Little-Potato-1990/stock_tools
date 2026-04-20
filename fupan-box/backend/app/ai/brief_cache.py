"""三层 brief cache: 内存 TTL → PostgreSQL 持久 → 实时 LLM.

设计:
    - 内存层 (90s, singleflight): 防点击风暴 + 高频去重
    - PG 层 (默认 24h): 跨进程持久, 重启不丢, celery 预热写入
    - LLM 层: 兜底实时生成, 完成后回写 PG + 内存

key 必须是稳定字符串 (e.g. "why_rose:600519:2026-04-20:deepseek-v3").

提供:
    pg_get(key, now=None)      # 读 PG, 命中则 hit_count+=1, 返回 content; 未命中 None
    pg_set(...)                # 写 PG (upsert)
    cached_brief(key, ...)     # FastAPI 异步入口: 三层串
    sync_cached_brief(...)     # celery worker 同步入口
    invalidate_pg(prefix)      # 主动失效 (例如 ?refresh=1)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import date as date_type, datetime, timedelta
from typing import Any, Awaitable, Callable

from sqlalchemy import create_engine, select, update, delete, func, case
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.ai_cache import AIBriefCache

logger = logging.getLogger(__name__)

# ============== 内存层 (与原 _cache.py 等价但独立) ==============
_MEM: dict[str, tuple[float, Any]] = {}
_INFLIGHT: dict[str, asyncio.Future] = {}
DEFAULT_MEM_TTL = 90.0


def _mem_get(key: str, ttl: float) -> Any | None:
    item = _MEM.get(key)
    if not item:
        return None
    ts, val = item
    if time.time() - ts > ttl:
        _MEM.pop(key, None)
        return None
    return val


def _mem_set(key: str, val: Any) -> None:
    _MEM[key] = (time.time(), val)


# ============== PG 层 (sync, celery + fastapi 都能用) ==============
def _engine():
    return create_engine(get_settings().database_url_sync, pool_pre_ping=True)


def pg_get(key: str, now: datetime | None = None) -> dict | None:
    now = now or datetime.now()
    eng = _engine()
    try:
        with Session(eng) as session:
            row = session.execute(
                select(AIBriefCache).where(AIBriefCache.cache_key == key)
            ).scalar_one_or_none()
            if not row:
                return None
            if row.expires_at <= now:
                return None
            row.hit_count = (row.hit_count or 0) + 1
            session.commit()
            return row.content
    finally:
        eng.dispose()


def pg_set(
    key: str,
    content: dict,
    *,
    action: str,
    model: str | None,
    trade_date: date_type | None,
    ttl_hours: float = 24.0,
    source: str = "ondemand",
) -> None:
    if not isinstance(content, dict):
        try:
            content = dict(content)
        except Exception:
            content = {"raw": json.dumps(content, ensure_ascii=False, default=str)}

    now = datetime.now()
    expires = now + timedelta(hours=ttl_hours)
    eng = _engine()
    try:
        with Session(eng) as session:
            stmt = pg_insert(AIBriefCache).values(
                cache_key=key,
                action=action,
                model=model,
                trade_date=trade_date,
                content=content,
                generated_at=now,
                expires_at=expires,
                hit_count=0,
                source=source,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["cache_key"],
                set_={
                    "content": stmt.excluded.content,
                    "model": stmt.excluded.model,
                    "trade_date": stmt.excluded.trade_date,
                    "generated_at": stmt.excluded.generated_at,
                    "expires_at": stmt.excluded.expires_at,
                    "source": stmt.excluded.source,
                    "action": stmt.excluded.action,
                },
            )
            session.execute(stmt)
            session.commit()
    finally:
        eng.dispose()


def invalidate_pg(prefix: str | None = None) -> int:
    """删除 cache 行 (按 cache_key 前缀, 或全部)."""
    eng = _engine()
    try:
        with Session(eng) as session:
            if prefix:
                stmt = delete(AIBriefCache).where(AIBriefCache.cache_key.like(f"{prefix}%"))
            else:
                stmt = delete(AIBriefCache)
            res = session.execute(stmt)
            session.commit()
            return int(res.rowcount or 0)
    finally:
        eng.dispose()


def cache_stats(days: int = 7) -> dict[str, Any]:
    eng = _engine()
    try:
        with Session(eng) as session:
            rows = session.execute(
                select(
                    AIBriefCache.action,
                    func.count(AIBriefCache.id),
                    func.sum(AIBriefCache.hit_count),
                    func.sum(case((AIBriefCache.source == "prewarm", 1), else_=0)),
                ).group_by(AIBriefCache.action)
            ).all()
            out = []
            for action, n, hits, prewarm_n in rows:
                out.append({
                    "action": action,
                    "rows": int(n),
                    "total_hits": int(hits or 0),
                    "prewarm_rows": int(prewarm_n or 0),
                    "hit_rate": round((int(hits or 0)) / max(int(n), 1), 2),
                })
            return {"by_action": out}
    finally:
        eng.dispose()


# ============== 三层 (异步入口, fastapi 用) ==============
async def cached_brief(
    key: str,
    fn: Callable[..., Awaitable[dict]],
    *args,
    action: str,
    model: str | None,
    trade_date: date_type | None,
    mem_ttl: float = DEFAULT_MEM_TTL,
    pg_ttl_h: float = 24.0,
    refresh: bool = False,
    **kwargs,
) -> dict:
    """三层缓存: mem → pg → fn (LLM).

    - refresh=True: 跳过两层, 重新生成 + 回写
    - 命中 PG 时回写 mem, 不再写 PG (无变化)
    - fn 必须返回 dict (其它类型用 default=str 序列化)
    """
    if refresh:
        _MEM.pop(key, None)
    else:
        m = _mem_get(key, mem_ttl)
        if m is not None:
            return m
        try:
            p = await asyncio.to_thread(pg_get, key)
        except Exception as e:
            logger.warning(f"pg_get failed key={key}: {e}")
            p = None
        if p is not None:
            _mem_set(key, p)
            return p

    inflight = _INFLIGHT.get(key)
    if inflight is not None:
        return await inflight

    loop = asyncio.get_event_loop()
    fut: asyncio.Future = loop.create_future()
    _INFLIGHT[key] = fut
    try:
        result = await fn(*args, **kwargs)
        if isinstance(result, dict):
            _mem_set(key, result)
            try:
                await asyncio.to_thread(
                    pg_set,
                    key,
                    result,
                    action=action,
                    model=model,
                    trade_date=trade_date,
                    ttl_hours=pg_ttl_h,
                    source="ondemand",
                )
            except Exception as e:
                logger.warning(f"pg_set failed key={key}: {e}")
        if not fut.done():
            fut.set_result(result)
        return result
    except Exception as e:
        if not fut.done():
            fut.set_exception(e)
        raise
    finally:
        _INFLIGHT.pop(key, None)


# ============== 同步包装 (celery worker 用, 用 asyncio.run) ==============
def sync_run_async(coro):
    """让 sync celery worker 跑异步 fn. 起独立 loop 不会和 fastapi 冲突."""
    try:
        loop = asyncio.new_event_loop()
        return loop.run_until_complete(coro)
    finally:
        try:
            loop.close()
        except Exception:
            pass
