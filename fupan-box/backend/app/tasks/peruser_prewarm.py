"""Per-user 预热 — 自选股相关 AI brief.

覆盖场景:
    - watchlist_brief  (自选股综合点评)
    - per-user news_brief (public_only=0 时才用)  -- 可选
    - 自选股逐只 multi_perspective / why_rose (命中 universe 的共享 cache)

触发点 (由调用方决定):
    1. api/auth.py POST /login 成功后 (BackgroundTasks) → prewarm_user_bundle.delay
    2. api/watchlist.py 添加 / 删除自选后 → prewarm_user_bundle.delay
    3. beat 夜间 21:00 `prewarm_active_users` → 遍历近 7 日活跃用户 → 逐个 prewarm

PG TTL 复用各 brief 默认值; watchlist_brief 走原服务, 内部 key 已含 user+hash.
"""
from __future__ import annotations

import logging
from datetime import date as date_type, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.ai.brief_cache import sync_run_async
from app.ai.brief_generator import _latest_trade_date_with_data
from app.config import get_settings
from app.models.user import UserAIQuotaLog, UserWatchlist
from app.services.universe_resolver import resolve_user_universe
from app.tasks.celery_app import celery

logger = logging.getLogger(__name__)


PERUSER_CONCURRENCY_DEFAULT = 2


async def _prewarm_user_bundle_async(user_id: int) -> dict:
    """给单个 user 预热 watchlist_brief + 每只自选股 multi_perspective + swing_brief.

    个股 brief 的 cache_key 不含 user, 与全局 universe 共享; 这里只是"拉一遍触发命中",
    如果 universe 已覆盖则直接 skipped_cached.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.ai.brief_cache import pg_get, pg_set
    from app.ai.multi_perspective import generate_multi_perspective
    from app.ai.swing_brief import generate_swing_brief
    from app.services.watchlist_service import get_or_generate_watchlist_brief

    td = _latest_trade_date_with_data() or date_type.today()
    codes = resolve_user_universe(user_id, td)

    settings = get_settings()
    eng = create_async_engine(settings.database_url, pool_pre_ping=True)
    maker = async_sessionmaker(eng, expire_on_commit=False)

    result: dict = {"user_id": user_id, "codes": len(codes)}
    try:
        async with maker() as session:
            try:
                wl_res = await get_or_generate_watchlist_brief(
                    session, user_id, trade_date=td, model="deepseek-v3", refresh=False,
                )
                result["watchlist_brief"] = "ok" if isinstance(wl_res, dict) else "skipped"
            except Exception as e:
                logger.warning(f"peruser watchlist_brief user={user_id}: {e}")
                result["watchlist_brief_error"] = str(e)[:120]

        sem = asyncio.Semaphore(PERUSER_CONCURRENCY_DEFAULT)

        async def _mp(code: str) -> str:
            async with sem:
                key = f"multi_perspective:{code}:{td.isoformat()}:deepseek-v3"
                cached = await asyncio.to_thread(pg_get, key)
                if cached is not None:
                    return "skipped_cached"
                try:
                    out = await generate_multi_perspective(code, td, "deepseek-v3")
                    await asyncio.to_thread(
                        pg_set, key, out,
                        action="multi_perspective", model="deepseek-v3",
                        trade_date=td, ttl_hours=24.0, source="peruser_prewarm",
                    )
                    return "ok"
                except Exception as e:
                    logger.warning(f"peruser mp {code}: {e}")
                    return "error"

        async def _sw(code: str) -> str:
            async with sem:
                key = f"swing_brief:{code}:{td.isoformat()}:deepseek-v3"
                cached = await asyncio.to_thread(pg_get, key)
                if cached is not None:
                    return "skipped_cached"
                try:
                    out = await generate_swing_brief(code, td, "deepseek-v3")
                    await asyncio.to_thread(
                        pg_set, key, out,
                        action="swing_brief", model="deepseek-v3",
                        trade_date=td, ttl_hours=24.0, source="peruser_prewarm",
                    )
                    return "ok"
                except Exception as e:
                    logger.warning(f"peruser sw {code}: {e}")
                    return "error"

        mp_tasks = [_mp(c) for c in codes]
        sw_tasks = [_sw(c) for c in codes]
        mp_res = await asyncio.gather(*mp_tasks) if mp_tasks else []
        sw_res = await asyncio.gather(*sw_tasks) if sw_tasks else []

        def _count(arr: list[str]) -> dict:
            out: dict[str, int] = {}
            for s in arr:
                out[s] = out.get(s, 0) + 1
            return out

        result["multi_perspective"] = _count(mp_res)
        result["swing_brief"] = _count(sw_res)
    finally:
        await eng.dispose()

    return result


@celery.task(name="app.tasks.peruser_prewarm.prewarm_user_bundle")
def prewarm_user_bundle(user_id: int) -> dict:
    """单用户预热 (事件驱动入口, FastAPI 侧用 .delay(user_id) 排队)."""
    if not user_id:
        return {"status": "skipped", "reason": "no user_id"}
    return sync_run_async(_prewarm_user_bundle_async(int(user_id)))


def _active_user_ids(days: int = 7) -> list[int]:
    """近 N 日有 quota_log 或自选股的用户 id, 用于夜间兜底批处理."""
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    start = date_type.today() - timedelta(days=days)
    try:
        with Session(eng) as s:
            ids: set[int] = set()
            rows = s.execute(
                select(UserAIQuotaLog.user_id)
                .where(UserAIQuotaLog.log_date >= start)
                .distinct()
            ).scalars().all()
            ids.update(int(x) for x in rows if x)

            rows = s.execute(select(UserWatchlist.user_id).distinct()).scalars().all()
            ids.update(int(x) for x in rows if x)

            return sorted(ids)
    finally:
        eng.dispose()


@celery.task(name="app.tasks.peruser_prewarm.prewarm_active_users")
def prewarm_active_users(days: int = 7, max_users: int = 500) -> dict:
    """夜间兜底: 近 N 日活跃用户批量预热. 按 max_users 截断, 串行排队避免打爆 LLM."""
    ids = _active_user_ids(days)
    if max_users and len(ids) > max_users:
        ids = ids[:max_users]
    queued = 0
    for uid in ids:
        try:
            prewarm_user_bundle.delay(uid)
            queued += 1
        except Exception as e:
            logger.warning(f"prewarm_active_users enqueue uid={uid}: {e}")
    return {"active_users": len(ids), "queued": queued}
