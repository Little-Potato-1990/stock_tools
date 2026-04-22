"""自选股相关业务逻辑 — service 层.

把 ai_brief 路由里的 db 查询 + cache key 计算 + brief 生成集中在这里,
未来若新增"自选股每日早报""自选股 alert"等场景, 都从本服务复用 codes 拉取.
"""
from __future__ import annotations

from datetime import date as date_type
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.brief_cache import cached_brief
from app.ai.brief_generator import _latest_trade_date_with_data
from app.ai.watchlist_brief import codes_hash, generate_watchlist_brief
from app.ai.active_skill import aresolve_active_skill_for_user
from app.models.user import UserWatchlist


async def get_user_watchlist_codes(db: AsyncSession, user_id: int) -> list[str]:
    rows = (
        await db.execute(
            select(UserWatchlist.stock_code).where(UserWatchlist.user_id == user_id)
        )
    ).scalars().all()
    return [str(c) for c in rows]


async def get_or_generate_watchlist_brief(
    db: AsyncSession,
    user_id: int,
    *,
    trade_date: date_type | None,
    model: str,
    refresh: bool = False,
    skill_ref: str | None = None,
) -> dict[str, Any]:
    codes = await get_user_watchlist_codes(db, user_id)
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date_type.today()
    h = codes_hash(codes)

    # 解析激活体系，把 ref 拼到 cache key（不同 skill 隔离缓存）
    active_skill = await aresolve_active_skill_for_user(db, user_id, skill_ref)
    skill_tag = active_skill.ref.replace(":", "-") if active_skill else "neutral"

    cache_key = f"watchlist_brief:{user_id}:{h}:{trade_date}:{model}:{skill_tag}"
    return await cached_brief(
        cache_key,
        generate_watchlist_brief,
        codes,
        trade_date,
        model,
        action="watchlist_brief",
        model=model,
        trade_date=trade_date,
        mem_ttl=1800.0,
        pg_ttl_h=1.0,
        refresh=refresh,
        active_skill=active_skill,
    )
