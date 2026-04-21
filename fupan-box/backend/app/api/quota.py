"""商业化分层 + AI 配额中间件.

Tier 配置 (每用户每日):
    free    : chat=10  why_rose=3  debate=1   trade_review=1
    monthly : chat=100 why_rose=30 debate=10  trade_review=10
    yearly  : chat=500 why_rose=200 debate=80 trade_review=80

不计 quota 的动作 (共享/系统级):
    brief  : 全平台共享缓存
    anomaly: 系统主动推送
"""
from __future__ import annotations

from datetime import date as date_type, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.api.auth import get_current_user
from app.models.user import User, UserAIQuotaLog


router = APIRouter()


TIER_QUOTA: dict[str, dict[str, int]] = {
    # anonymous (未登录) 仅由 RateLimitMiddleware 按 IP 限流, 不走 user-quota,
    # 列在这里仅为 /tiers 端点呈现给前端做引导对比.
    "anonymous": {"chat": 0,   "why_rose": 0,   "debate": 0,  "trade_review": 0},
    "free":      {"chat": 10,  "why_rose": 3,   "debate": 1,  "trade_review": 1},
    "monthly":   {"chat": 100, "why_rose": 30,  "debate": 10, "trade_review": 10},
    "yearly":    {"chat": 500, "why_rose": 200, "debate": 80, "trade_review": 80},
}

TIER_LABEL = {
    "anonymous": "访客",
    "free":      "免费版",
    "monthly":   "月度 Pro",
    "yearly":    "年度 Master",
}

TIER_PRICE_RMB = {
    "anonymous": 0,
    "free":      0,
    "monthly":   39,
    "yearly":    299,
}

TIER_FEATURES: dict[str, list[str]] = {
    "anonymous": [
        "全市场行情/涨停/题材/资金/新闻只读",
        "AI 一句话速读 (短/波段/长 三视角)",
        "估值回看 3 个月",
    ],
    "free": [
        "访客全部功能",
        "自选股 + 智能交易计划",
        "AI 副驾对话 10 次/天",
        "估值回看 1 年",
    ],
    "monthly": [
        "免费版全部功能",
        "AI 副驾 100 次/天 + 多空辩论",
        "估值/财务回看 5 年 / 5 年 / 3 年",
        "全市场筛选榜单 200 行",
    ],
    "yearly": [
        "Pro 全部功能",
        "AI 副驾 500 次/天 + 80 次辩论",
        "全市场筛选榜单 500 行",
        "数据导出 + API",
    ],
}


def get_tier_quota(tier: str) -> dict[str, int]:
    return TIER_QUOTA.get(tier, TIER_QUOTA["free"])


async def check_and_log_quota(
    db: AsyncSession,
    user: User,
    action: str,
    model: str | None = None,
    cost_pts: int = 1,
) -> int:
    """检查 + 记录. 配额不足时抛 402.

    Returns:
        本日用过的量 (含本次).
    """
    quota = get_tier_quota(user.tier).get(action)
    if quota is None:
        return 0

    today = date_type.today()
    used = await db.scalar(
        select(func.coalesce(func.sum(UserAIQuotaLog.cost_pts), 0)).where(
            UserAIQuotaLog.user_id == user.id,
            UserAIQuotaLog.log_date == today,
            UserAIQuotaLog.action == action,
        )
    )
    used = int(used or 0)

    if used + cost_pts > quota:
        raise HTTPException(
            402,
            detail={
                "error": "quota_exceeded",
                "action": action,
                "tier": user.tier,
                "tier_label": TIER_LABEL.get(user.tier, user.tier),
                "used": used,
                "quota": quota,
                "msg": f"今日 {action} 已用 {used}/{quota} (套餐: {TIER_LABEL.get(user.tier, user.tier)}). 升级 Pro/Master 解锁更多额度.",
            },
        )

    log = UserAIQuotaLog(user_id=user.id, action=action, model=model, cost_pts=cost_pts)
    db.add(log)
    await db.commit()
    return used + cost_pts


@router.get("/usage")
async def get_usage(
    days: int = 1,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """当日 (默认) 各动作配额使用情况."""
    today = date_type.today()
    since = today - timedelta(days=days - 1)
    rows = await db.execute(
        select(
            UserAIQuotaLog.action,
            func.coalesce(func.sum(UserAIQuotaLog.cost_pts), 0).label("used"),
        )
        .where(UserAIQuotaLog.user_id == user.id, UserAIQuotaLog.log_date >= since)
        .group_by(UserAIQuotaLog.action)
    )
    used_map = {r.action: int(r.used) for r in rows.all()}
    quota = get_tier_quota(user.tier)

    actions: list[dict] = []
    for action, q in quota.items():
        used = used_map.get(action, 0)
        actions.append({
            "action": action,
            "label": _ACTION_LABEL.get(action, action),
            "used": used,
            "quota": q,
            "remaining": max(0, q - used),
            "percent": min(100, round(used / q * 100)) if q else 0,
        })

    return {
        "tier": user.tier,
        "tier_label": TIER_LABEL.get(user.tier, user.tier),
        "tier_price_rmb": TIER_PRICE_RMB.get(user.tier, 0),
        "trade_date": today.isoformat(),
        "actions": actions,
    }


@router.get("/tiers")
async def get_tiers():
    """所有套餐对比 — 用于升级页."""
    out = []
    for tier, quota in TIER_QUOTA.items():
        out.append({
            "tier": tier,
            "tier_label": TIER_LABEL[tier],
            "price_rmb": TIER_PRICE_RMB[tier],
            "features": TIER_FEATURES.get(tier, []),
            "quota": [
                {"action": a, "label": _ACTION_LABEL.get(a, a), "quota": q}
                for a, q in quota.items()
            ],
        })
    return out


_ACTION_LABEL = {
    "chat": "AI 副驾对话",
    "why_rose": "为什么涨 / 跌",
    "debate": "多空辩论",
    "trade_review": "我的交易复盘",
}
