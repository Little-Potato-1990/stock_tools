"""用户私人维度聚合 (sidebar 解锁判断 + MyDigestFloating 速览).

合并多个轻量计数到一次请求, 减少前端轮询数.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.database import get_db
from app.models.ai import AIPrediction
from app.models.plan import UserPlan, UserPlanTrigger
from app.models.user import User, UserWatchlist, UserTrade

router = APIRouter()


class WatchlistStatus(BaseModel):
    unlocked: bool
    count: int
    codes: list[str]


class PlansStatus(BaseModel):
    unlocked: bool
    active: int
    triggered: int
    today_triggers: int
    triggered_codes: list[str]


class TradesStatus(BaseModel):
    unlocked: bool
    count_total: int
    count_7d: int


class AiTrackStatus(BaseModel):
    unlocked: bool
    verified_7d: int


class PrivateStatusOut(BaseModel):
    watchlist: WatchlistStatus
    plans: PlansStatus
    trades: TradesStatus
    ai_track: AiTrackStatus


@router.get("/private-status", response_model=PrivateStatusOut)
async def private_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()
    week_ago = today - timedelta(days=7)

    wl_rows = await db.execute(
        select(UserWatchlist.stock_code).where(UserWatchlist.user_id == user.id)
    )
    wl_codes = sorted({c for (c,) in wl_rows.all() if c})
    wl_count = len(wl_codes)

    plans_active = int(
        await db.scalar(
            select(func.count(UserPlan.id)).where(
                UserPlan.user_id == user.id, UserPlan.status == "active"
            )
        )
        or 0
    )
    plans_triggered = int(
        await db.scalar(
            select(func.count(UserPlan.id)).where(
                UserPlan.user_id == user.id, UserPlan.status == "triggered"
            )
        )
        or 0
    )
    today_triggers = int(
        await db.scalar(
            select(func.count(UserPlanTrigger.id)).where(
                UserPlanTrigger.user_id == user.id,
                UserPlanTrigger.trade_date == today,
            )
        )
        or 0
    )
    code_rows = await db.execute(
        select(UserPlan.code).where(
            UserPlan.user_id == user.id,
            UserPlan.status.in_(["active", "triggered"]),
        )
    )
    triggered_codes = sorted({c for (c,) in code_rows.all() if c})

    trades_total = int(
        await db.scalar(
            select(func.count(UserTrade.id)).where(UserTrade.user_id == user.id)
        )
        or 0
    )
    trades_7d = int(
        await db.scalar(
            select(func.count(UserTrade.id)).where(
                UserTrade.user_id == user.id, UserTrade.trade_date >= week_ago
            )
        )
        or 0
    )

    verified_7d = int(
        await db.scalar(
            select(func.count(AIPrediction.id)).where(
                AIPrediction.trade_date >= week_ago,
                AIPrediction.verified_at.isnot(None),
            )
        )
        or 0
    )

    return PrivateStatusOut(
        watchlist=WatchlistStatus(unlocked=wl_count > 0, count=wl_count, codes=wl_codes),
        plans=PlansStatus(
            unlocked=(plans_active + plans_triggered) > 0,
            active=plans_active,
            triggered=plans_triggered,
            today_triggers=today_triggers,
            triggered_codes=triggered_codes,
        ),
        trades=TradesStatus(
            unlocked=trades_total > 0,
            count_total=trades_total,
            count_7d=trades_7d,
        ),
        ai_track=AiTrackStatus(
            unlocked=verified_7d > 0,
            verified_7d=verified_7d,
        ),
    )
