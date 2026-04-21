"""异动 AI 解读 — 用户点开详情时按需调.

输入: anomaly id
输出: 一句话点评 (≤30 字) — 解释这个异动的可能原因 + 操作建议
策略: 拉个股近 5 日 K + 涨停记录 + 同板块异动数 + 当前同方向异动数, 让 LLM 综合
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import create_engine, select, desc, and_
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm
from app.config import get_settings
from app.intraday.labels import label_anomaly
from app.models.anomaly import IntradayAnomaly
from app.models.market import LimitUpRecord
from app.models.stock import DailyQuote, Stock

logger = logging.getLogger(__name__)


def _build_context(anom: IntradayAnomaly) -> dict[str, Any] | None:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            stock = None
            if anom.code:
                stock = session.execute(
                    select(Stock).where(Stock.code == anom.code)
                ).scalar_one_or_none()

            recent: list[dict[str, Any]] = []
            recent_lu: list[dict[str, Any]] = []
            if anom.code:
                rq = session.execute(
                    select(DailyQuote)
                    .where(DailyQuote.stock_code == anom.code)
                    .order_by(desc(DailyQuote.trade_date))
                    .limit(5)
                ).scalars().all()
                recent = [
                    {
                        "date": q.trade_date.isoformat(),
                        "close": float(q.close) if q.close else 0,
                        "chg": float(q.change_pct) if q.change_pct else 0,
                        "amount_yi": round(float(q.amount or 0) / 1e8, 2),
                        "is_lu": bool(q.is_limit_up),
                    }
                    for q in reversed(rq)
                ]
                rl = session.execute(
                    select(LimitUpRecord)
                    .where(LimitUpRecord.stock_code == anom.code)
                    .order_by(desc(LimitUpRecord.trade_date))
                    .limit(3)
                ).scalars().all()
                recent_lu = [
                    {
                        "date": r.trade_date.isoformat(),
                        "board": r.continuous_days,
                        "themes": r.theme_names or [],
                        "broken": (r.open_count or 0) > 0,
                    }
                    for r in rl
                ]

            same_dir_today = session.execute(
                select(IntradayAnomaly).where(
                    and_(
                        IntradayAnomaly.trade_date == anom.trade_date,
                        IntradayAnomaly.anomaly_type == anom.anomaly_type,
                        IntradayAnomaly.id != anom.id,
                    )
                )
            ).scalars().all()
            same_dir_count = len(same_dir_today)

            return {
                "anom_id": anom.id,
                "anomaly_type": anom.anomaly_type,
                "anomaly_label": label_anomaly(anom.anomaly_type),
                "code": anom.code,
                "name": anom.name,
                "industry": stock.industry if stock else None,
                "price": anom.price,
                "change_pct": anom.change_pct,
                "delta_5m_pct": anom.delta_5m_pct,
                "volume_yi": anom.volume_yi,
                "severity": anom.severity,
                "detected_at": anom.detected_at.isoformat(),
                "recent_5d": recent,
                "recent_limit_ups": recent_lu,
                "same_direction_today": same_dir_count,
            }
    finally:
        engine.dispose()


def _heuristic_brief(ctx: dict[str, Any]) -> str:
    label = ctx["anomaly_label"]
    name = ctx["name"] or ctx["code"] or ""
    chg = ctx["change_pct"] or 0
    delta = ctx["delta_5m_pct"] or 0
    same = ctx["same_direction_today"]
    has_lu = any(lu["board"] >= 1 for lu in ctx.get("recent_limit_ups", []))
    if ctx["anomaly_type"] == "surge":
        return f"{name} 5min 拉升 +{delta}% 当前 +{chg:.1f}%; 同向 {same} 只, " + ("近期连板有题材属性" if has_lu else "题材待观察")
    if ctx["anomaly_type"] == "plunge":
        return f"{name} 5min 跳水 {delta}% 当前 {chg:.1f}%; 同向 {same} 只, 注意止损"
    if ctx["anomaly_type"] == "break":
        return f"{name} 涨停打开当前 {chg:.1f}%; 同板炸板 {same} 只, " + ("注意分歧" if same >= 2 else "暂时孤立")
    if ctx["anomaly_type"] == "seal":
        return f"{name} 反包封板 +{chg:.1f}%; 同向 {same} 只, " + ("情绪修复" if same >= 2 else "孤兵突进")
    return f"{label}: {name} {chg:.1f}%"


async def generate_anomaly_brief(anom_id: int, model_id: str = "deepseek-v3") -> dict[str, Any]:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            anom = session.execute(
                select(IntradayAnomaly).where(IntradayAnomaly.id == anom_id)
            ).scalar_one_or_none()
            if not anom:
                return {"id": anom_id, "error": "not_found"}
    finally:
        engine.dispose()

    ctx = _build_context(anom)
    if not ctx:
        return {"id": anom_id, "error": "no_context"}

    heur = _heuristic_brief(ctx)
    system = (
        "你是 A 股盘中异动解读助手。给一段 ≤ 40 字的中文点评, 解释异动可能成因 + 操作提示。"
        "**禁止**: 编造数据、给具体买卖价、空话。"
        "严格按 JSON schema: {\"brief\": \"...\"}"
    )
    user = (
        f"异动数据:\n```json\n{json.dumps(ctx, ensure_ascii=False)[:2000]}\n```\n"
        "请输出 JSON: {\"brief\": \"<=40字的盘中点评\"}"
    )
    out = await _call_llm(system, user, model_id)
    brief = (out or {}).get("brief", "").strip() or heur
    if len(brief) > 80:
        brief = brief[:80]

    # 写回 DB (anomaly.ai_brief 字段)
    engine = create_engine(settings.database_url_sync)
    try:
        with Session(engine) as session:
            anom = session.execute(
                select(IntradayAnomaly).where(IntradayAnomaly.id == anom_id)
            ).scalar_one_or_none()
            if anom:
                anom.ai_brief = brief
                session.commit()
    finally:
        engine.dispose()

    return {
        "id": anom_id,
        "brief": brief,
        "model": model_id,
        "context": ctx,
    }


def generate_anomaly_brief_sync(anom_id: int, model_id: str = "deepseek-v3") -> dict[str, Any]:
    """celery worker / detector 同步入口. 内部跑独立 event loop."""
    import asyncio
    try:
        loop = asyncio.new_event_loop()
        return loop.run_until_complete(generate_anomaly_brief(anom_id, model_id))
    finally:
        try:
            loop.close()
        except Exception:
            pass
