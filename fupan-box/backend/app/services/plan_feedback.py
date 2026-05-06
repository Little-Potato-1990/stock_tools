"""计划回顾反馈：落库 + 更新用户画像."""

from __future__ import annotations

from datetime import datetime, date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan import UserPlanFeedback, UserTradingProfile


def _safe_ratio(num: int | float, den: int | float) -> float:
    d = float(den or 0)
    if d <= 0:
        return 0.0
    return float(num or 0) / d


async def write_feedback_and_update_profile(
    db: AsyncSession,
    *,
    user_id: int,
    plan_date: date,
    plan_version_id: int | None,
    planned_count: int,
    hit_count: int,
    miss_count: int,
    unexpected_count: int,
    net_pnl: float,
    detail_items: list[dict[str, Any]] | None = None,
) -> None:
    """幂等写反馈，并把执行纪律指标平滑写入用户画像."""
    row = await db.scalar(
        select(UserPlanFeedback).where(
            UserPlanFeedback.user_id == user_id,
            UserPlanFeedback.plan_date == plan_date,
        )
    )
    payload = {
        "planned_count": planned_count,
        "hit_count": hit_count,
        "miss_count": miss_count,
        "unexpected_count": unexpected_count,
        "net_pnl": round(float(net_pnl or 0.0), 2),
        "items": detail_items or [],
    }
    if row is None:
        row = UserPlanFeedback(
            user_id=user_id,
            plan_date=plan_date,
            plan_version_id=plan_version_id,
            planned_count=planned_count,
            hit_count=hit_count,
            miss_count=miss_count,
            unexpected_count=unexpected_count,
            net_pnl=round(float(net_pnl or 0.0), 2),
            feedback_json=payload,
        )
        db.add(row)
    else:
        row.plan_version_id = plan_version_id
        row.planned_count = planned_count
        row.hit_count = hit_count
        row.miss_count = miss_count
        row.unexpected_count = unexpected_count
        row.net_pnl = round(float(net_pnl or 0.0), 2)
        row.feedback_json = payload
        row.updated_at = datetime.now()

    profile_row = await db.scalar(
        select(UserTradingProfile).where(UserTradingProfile.user_id == user_id)
    )
    profile_json = dict(profile_row.profile_json or {}) if profile_row else {}

    feedback = dict(profile_json.get("plan_feedback") or {})
    reviewed_days = int(feedback.get("reviewed_days") or 0)
    prev_hit = float(feedback.get("avg_hit_rate") or 0.0)
    prev_discipline = float(feedback.get("avg_discipline") or 0.0)
    prev_deviation = float(feedback.get("avg_deviation_rate") or 0.0)

    total_trades = int(hit_count + miss_count + unexpected_count)
    hit_rate = _safe_ratio(hit_count, planned_count)
    discipline = 1.0 - _safe_ratio(unexpected_count, max(1, total_trades))
    deviation_rate = _safe_ratio(unexpected_count, max(1, total_trades))
    n = reviewed_days + 1

    feedback.update(
        {
            "reviewed_days": n,
            "last_plan_date": plan_date.isoformat(),
            "avg_hit_rate": round((prev_hit * reviewed_days + hit_rate) / n, 4),
            "avg_discipline": round((prev_discipline * reviewed_days + discipline) / n, 4),
            "avg_deviation_rate": round((prev_deviation * reviewed_days + deviation_rate) / n, 4),
            "last_net_pnl": round(float(net_pnl or 0.0), 2),
        }
    )
    profile_json["plan_feedback"] = feedback

    if profile_row is None:
        profile_row = UserTradingProfile(user_id=user_id, profile_json=profile_json)
        db.add(profile_row)
    else:
        profile_row.profile_json = profile_json
        profile_row.updated_at = datetime.now()

    await db.commit()
