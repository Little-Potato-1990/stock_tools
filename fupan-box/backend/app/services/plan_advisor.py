"""AI 草案计划服务: 画像聚合 + 草案生成."""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.llm_service import _get_client
from app.config import get_settings
from app.models.plan import UserTradingProfile
from app.models.user import UserHolding, UserTrade

logger = logging.getLogger(__name__)


def _risk_level_from_metrics(chase_rate: float, avg_holding_minutes: float, win_rate: float) -> str:
    if chase_rate >= 0.45 and avg_holding_minutes <= 240:
        return "aggressive"
    if chase_rate <= 0.2 and avg_holding_minutes >= 1440:
        return "conservative"
    if win_rate >= 0.6 and chase_rate <= 0.35:
        return "balanced_plus"
    return "balanced"


def _holding_style_from_minutes(avg_holding_minutes: float) -> str:
    if avg_holding_minutes <= 240:
        return "ultra_short"
    if avg_holding_minutes <= 2880:
        return "swing"
    return "position"


async def build_user_profile(db: AsyncSession, user_id: int, lookback_days: int = 120) -> dict[str, Any]:
    since = date.today() - timedelta(days=lookback_days)
    trades = (
        await db.execute(
            select(UserTrade)
            .where(UserTrade.user_id == user_id, UserTrade.trade_date >= since)
            .order_by(UserTrade.trade_date.desc())
        )
    ).scalars().all()

    total = len(trades)
    win = sum(1 for t in trades if (t.pnl or 0) > 0)
    avg_holding = (
        sum((t.holding_minutes or 0) for t in trades if t.holding_minutes is not None)
        / max(1, sum(1 for t in trades if t.holding_minutes is not None))
        if trades
        else 0
    )
    chase = sum(1 for t in trades if (t.intraday_chg_at_buy or 0) > 5)
    avg_pnl_pct = (sum((t.pnl_pct or 0) for t in trades) / total) if total else 0.0
    win_rate = (win / total) if total else 0.0
    chase_rate = (chase / total) if total else 0.0
    risk_level = _risk_level_from_metrics(chase_rate, avg_holding, win_rate)
    holding_style = _holding_style_from_minutes(avg_holding)

    freq: dict[str, int] = {}
    for t in trades:
        if not t.code:
            continue
        freq[t.code] = freq.get(t.code, 0) + 1
    top_codes = [c for c, _ in sorted(freq.items(), key=lambda kv: kv[1], reverse=True)[:5]]

    profile = {
        "lookback_days": lookback_days,
        "trade_count": total,
        "win_rate": round(win_rate, 4),
        "avg_pnl_pct": round(avg_pnl_pct, 4),
        "avg_holding_minutes": round(avg_holding, 1),
        "chase_rate": round(chase_rate, 4),
        "risk_level": risk_level,
        "holding_style": holding_style,
        "preferred_codes": top_codes,
        "updated_at": date.today().isoformat(),
    }
    return profile


def _heuristic_draft(
    profile: dict[str, Any],
    holdings: list[UserHolding],
    plan_date: date,
) -> dict[str, Any]:
    risk_level = str(profile.get("risk_level") or "balanced")
    stop_loss_pct = 4.0 if risk_level in ("aggressive", "balanced_plus") else 3.0
    take_profit_pct = 8.0 if risk_level in ("aggressive", "balanced_plus") else 6.0
    max_pos = 30 if risk_level == "aggressive" else 20

    items: list[dict[str, Any]] = []
    sorted_holdings = sorted(holdings, key=lambda h: float(h.market_value or 0), reverse=True)
    for h in sorted_holdings[:3]:
        code = h.stock_code
        if not code:
            continue
        name = h.stock_name
        pnl_pct = float(h.pnl_pct or 0)
        if pnl_pct >= 8:
            direction = "reduce"
            trigger = {"type": "change_pct_below", "value": -2.0, "label": "强势后回落破 -2% 减仓"}
        elif pnl_pct <= -5:
            direction = "add"
            trigger = {"type": "change_pct_above", "value": 2.0, "label": "先转强, 涨幅上破 +2% 再考虑加仓"}
        else:
            direction = "buy"
            trigger = {"type": "change_pct_above", "value": 1.5, "label": "开盘后走强再关注"}
        items.append(
            {
                "code": code,
                "name": name,
                "direction": direction,
                "trigger_conditions": [trigger],
                "invalid_conditions": [{"type": "change_pct_below", "value": -3.0, "label": "弱势失效"}],
                "position_plan": {"max_position_pct": max_pos},
                "stop_loss_pct": stop_loss_pct,
                "take_profit_pct": take_profit_pct,
                "notes": "AI 初版, 建议按盘中强弱动态微调",
            }
        )

    if not items:
        for code in (profile.get("preferred_codes") or [])[:3]:
            items.append(
                {
                    "code": code,
                    "name": None,
                    "direction": "buy",
                    "trigger_conditions": [{"type": "change_pct_above", "value": 2.0, "label": "转强后再考虑"}],
                    "invalid_conditions": [{"type": "change_pct_below", "value": -3.0, "label": "弱势不做"}],
                    "position_plan": {"max_position_pct": max_pos},
                    "stop_loss_pct": stop_loss_pct,
                    "take_profit_pct": take_profit_pct,
                    "notes": "基于历史偏好代码生成",
                }
            )

    return {
        "plan_date": plan_date.isoformat(),
        "market_view": "先防守后进攻, 优先做强势确认后的低风险参与",
        "style_hint": {
            "risk_level": risk_level,
            "holding_style": profile.get("holding_style"),
            "chase_rate": profile.get("chase_rate"),
        },
        "items": items,
    }


async def _llm_polish_draft(
    profile: dict[str, Any],
    base_draft: dict[str, Any],
    model: str,
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.openai_api_key:
        return base_draft
    prompt = (
        "你是A股交易计划助手。请基于用户画像和初版计划, 优化为更可执行的JSON。\n"
        "要求: 输出严格JSON对象, 字段保持: plan_date, market_view, style_hint, items。\n"
        "items 每项必须包含: code,name,direction,trigger_conditions,invalid_conditions,"
        "position_plan,stop_loss_pct,take_profit_pct,notes。\n"
        "trigger_conditions/invalid_conditions 的 type 只能用: "
        "price_above,price_below,change_pct_above,change_pct_below,limit_up,limit_up_break。\n"
        "不要输出 markdown。\n"
        f"\n用户画像:\n{json.dumps(profile, ensure_ascii=False)}\n"
        f"\n初版计划:\n{json.dumps(base_draft, ensure_ascii=False)}\n"
    )
    try:
        resp = await _get_client().chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1800,
        )
        txt = (resp.choices[0].message.content or "").strip()
        if not txt:
            return base_draft
        parsed = json.loads(txt)
        if isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
            return parsed
        return base_draft
    except Exception as e:
        logger.warning("plan advisor llm fallback heuristic: %s", e)
        return base_draft


async def generate_ai_plan_draft(
    db: AsyncSession,
    user_id: int,
    plan_date: date,
    model: str = "deepseek-v3",
) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = await build_user_profile(db, user_id)
    profile_row = await db.scalar(select(UserTradingProfile).where(UserTradingProfile.user_id == user_id))
    existing_feedback = (
        dict(profile_row.profile_json or {}).get("plan_feedback")
        if profile_row and isinstance(profile_row.profile_json, dict)
        else None
    )
    if isinstance(existing_feedback, dict):
        profile["plan_feedback"] = existing_feedback
    if profile_row is None:
        profile_row = UserTradingProfile(user_id=user_id, profile_json=profile)
        db.add(profile_row)
    else:
        profile_row.profile_json = profile
    await db.commit()

    holdings = (
        await db.execute(select(UserHolding).where(UserHolding.user_id == user_id))
    ).scalars().all()
    draft = _heuristic_draft(profile, list(holdings), plan_date)
    draft = await _llm_polish_draft(profile, draft, model=model)
    return profile, draft
