"""波段 AI brief —— 基于 5/10/20 日资金 + 北向 + 行业景气 + 周线形态.

数据源:
- get_stock_capital_sync (capital_5d_累计 / 北向 / 主力身份)
- DailyQuote 近 30 日 (周线形态)
- StockValuationDaily (PE 当前 + 1 年分位, 给波段也用)
- LimitUpRecord 历史 (近 30 日涨停频次)

输出:
{
  "code": "...", "name": "...", "trade_date": "...",
  "generated_at": "...", "model": "...",
  "headline": "≤30字 波段一句话",
  "stance": "看多|震荡偏强|震荡|震荡偏弱|看空",
  "trend_score": 1-10,            # 趋势强度
  "capital_score": 1-10,          # 主力 + 北向资金面
  "entry_zone": "≤40字 入场观察点",
  "exit_zone": "≤40字 止盈/止损观察点",
  "evidence": ["3 条 ≤30字 关键数字证据"]
}

PG TTL: 24 小时.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, select, desc, func as sa_func
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES
from app.config import get_settings
from app.models.market import LimitUpRecord
from app.models.stock import DailyQuote, Stock
from app.models.valuation import StockValuationDaily
from app.services.stock_context import get_stock_capital_sync

logger = logging.getLogger(__name__)


def _load_swing_context(code: str, trade_date: date) -> dict[str, Any] | None:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    try:
        with Session(engine) as s:
            stock = s.execute(select(Stock).where(Stock.code == code)).scalar_one_or_none()

            quotes = s.execute(
                select(DailyQuote)
                .where(
                    DailyQuote.stock_code == code,
                    DailyQuote.trade_date <= trade_date,
                )
                .order_by(desc(DailyQuote.trade_date))
                .limit(30)
            ).scalars().all()
            quotes = list(reversed(quotes))
            if not quotes:
                return None

            today = quotes[-1]
            close_now = float(today.close or 0)
            close_5d = float(quotes[-6].close) if len(quotes) >= 6 else close_now
            close_10d = float(quotes[-11].close) if len(quotes) >= 11 else close_now
            close_20d = float(quotes[-21].close) if len(quotes) >= 21 else close_now

            chg_5d = (close_now - close_5d) / close_5d * 100 if close_5d else 0
            chg_10d = (close_now - close_10d) / close_10d * 100 if close_10d else 0
            chg_20d = (close_now - close_20d) / close_20d * 100 if close_20d else 0

            highs = [float(q.high or 0) for q in quotes]
            lows = [float(q.low or 0) for q in quotes if q.low]
            ma5 = sum(float(q.close or 0) for q in quotes[-5:]) / max(min(5, len(quotes)), 1)
            ma10 = sum(float(q.close or 0) for q in quotes[-10:]) / max(min(10, len(quotes)), 1)
            ma20 = sum(float(q.close or 0) for q in quotes[-20:]) / max(min(20, len(quotes)), 1)

            avg_amount_5d = sum(float(q.amount or 0) for q in quotes[-5:]) / max(min(5, len(quotes)), 1) / 1e8

            lu_30d = s.execute(
                select(sa_func.count(LimitUpRecord.id))
                .where(
                    LimitUpRecord.stock_code == code,
                    LimitUpRecord.trade_date <= trade_date,
                    LimitUpRecord.trade_date >= trade_date - timedelta(days=30),
                )
            ).scalar_one() or 0

            val_today = s.execute(
                select(StockValuationDaily).where(
                    StockValuationDaily.stock_code == code,
                    StockValuationDaily.trade_date <= trade_date,
                ).order_by(desc(StockValuationDaily.trade_date)).limit(1)
            ).scalar_one_or_none()

            val_block = None
            if val_today:
                val_block = {
                    "pe_ttm": val_today.pe_ttm,
                    "pb": val_today.pb,
                    "pe_pct_3y": val_today.pe_pct_3y,
                    "pb_pct_3y": val_today.pb_pct_3y,
                }

            cap_ctx = {}
            try:
                cap_ctx = get_stock_capital_sync(code, trade_date) or {}
            except Exception as e:
                logger.debug(f"swing capital ctx {code} fail: {e}")

            return {
                "code": code,
                "name": stock.name if stock else code,
                "industry": stock.industry if stock else None,
                "trade_date": trade_date.isoformat(),
                "today": {
                    "close": close_now,
                    "change_pct": float(today.change_pct or 0),
                    "amount_yi": round(float(today.amount or 0) / 1e8, 2),
                    "turnover_rate": float(today.turnover_rate) if today.turnover_rate else None,
                },
                "trend": {
                    "chg_5d_pct": round(chg_5d, 2),
                    "chg_10d_pct": round(chg_10d, 2),
                    "chg_20d_pct": round(chg_20d, 2),
                    "ma5": round(ma5, 2),
                    "ma10": round(ma10, 2),
                    "ma20": round(ma20, 2),
                    "high_30d": round(max(highs), 2) if highs else None,
                    "low_30d": round(min(lows), 2) if lows else None,
                    "avg_amount_5d_yi": round(avg_amount_5d, 2),
                },
                "lu_30d_count": int(lu_30d),
                "valuation": val_block,
                "capital_ctx": cap_ctx,
            }
    finally:
        engine.dispose()


def _heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    name = ctx["name"]
    code = ctx["code"]
    trend = ctx.get("trend") or {}
    today = ctx.get("today") or {}

    chg_5d = trend.get("chg_5d_pct", 0)
    chg_20d = trend.get("chg_20d_pct", 0)
    close = today.get("close", 0)
    ma20 = trend.get("ma20", close)

    if chg_20d > 15 and close > ma20:
        trend_score = 9
        stance = "看多"
    elif chg_20d > 5 and close > ma20:
        trend_score = 7
        stance = "震荡偏强"
    elif chg_20d > -5:
        trend_score = 5
        stance = "震荡"
    elif chg_20d > -15:
        trend_score = 3
        stance = "震荡偏弱"
    else:
        trend_score = 2
        stance = "看空"

    cap_ctx = ctx.get("capital_ctx") or {}
    cap_5d = (cap_ctx.get("capital") or {}).get("main_inflow_5d_yi") if cap_ctx else None
    north_5d = (cap_ctx.get("capital") or {}).get("north_change_5d_yi") if cap_ctx else None

    capital_score = 5
    if cap_5d is not None:
        if cap_5d > 5:
            capital_score = 8
        elif cap_5d > 1:
            capital_score = 7
        elif cap_5d < -5:
            capital_score = 2
        elif cap_5d < -1:
            capital_score = 4

    headline = f"{name} 5日{chg_5d:+.1f}% 20日{chg_20d:+.1f}%"[:30]

    entry = (
        f"靠近 MA20({ma20:.2f}) 不破即可低吸"
        if close > ma20
        else f"突破 MA20({ma20:.2f}) 后再确认"
    )
    exit_ = (
        f"跌破 MA10({trend.get('ma10', 0):.2f}) 减仓"
        if close > ma20
        else f"反弹至 MA20({ma20:.2f}) 减仓"
    )

    evidence = [
        f"近 5 日 {chg_5d:+.1f}%",
        f"近 20 日 {chg_20d:+.1f}%",
    ]
    if cap_5d is not None:
        evidence.append(f"主力 5日 {cap_5d:+.1f}亿")

    return {
        "code": code,
        "name": name,
        "trade_date": ctx["trade_date"],
        "headline": headline,
        "stance": stance,
        "trend_score": trend_score,
        "capital_score": capital_score,
        "entry_zone": entry[:50],
        "exit_zone": exit_[:50],
        "evidence": evidence[:3],
    }


def _build_prompt(ctx: dict, hint: dict) -> tuple[str, str]:
    system = (
        f"你是 A 股波段交易者, 评估 {ctx['name']}({ctx['code']}) 5-20 日波段机会。"
        "输出严格 JSON, 综合 (a) 趋势强度 (b) 资金流向 (c) MA 形态 (d) 量能。"
        "**禁止**: 给具体买卖价 / 编造资金数据 / 套话(谨慎乐观/有待观察等)。"
        + NO_FLUFF_RULES
    )
    user = (
        f"快照:\n```json\n{json.dumps(ctx, ensure_ascii=False, default=str)[:4500]}\n```\n\n"
        f"规则版预判: stance={hint['stance']}, trend={hint['trend_score']}, cap={hint['capital_score']}\n\n"
        "请输出 JSON, schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "≤30字 一句话定性 (含具体数字: 涨幅或资金或量能)",\n'
        '  "stance": "看多|震荡偏强|震荡|震荡偏弱|看空",\n'
        '  "trend_score": 1-10 整数,\n'
        '  "capital_score": 1-10 整数,\n'
        '  "entry_zone": "≤40字 入场观察点 (引用 MA / 前高 / 量能, 不给具体价位区间)",\n'
        '  "exit_zone": "≤40字 减仓 / 止损观察点",\n'
        '  "evidence": ["3 条 ≤30字 关键数字证据"]\n'
        "}\n```\n不要 markdown fence。"
    )
    return system, user


def _merge(hint: dict, llm_out: dict | None) -> dict[str, Any]:
    base = dict(hint)
    if not llm_out:
        return base

    valid_stance = {"看多", "震荡偏强", "震荡", "震荡偏弱", "看空"}
    if (h := (llm_out.get("headline") or "").strip()):
        base["headline"] = h[:50]
    if llm_out.get("stance") in valid_stance:
        base["stance"] = llm_out["stance"]

    for k in ("trend_score", "capital_score"):
        v = llm_out.get(k)
        if isinstance(v, (int, float)) and 1 <= v <= 10:
            base[k] = int(v)

    for k in ("entry_zone", "exit_zone"):
        v = (llm_out.get(k) or "").strip()
        if v:
            base[k] = v[:60]

    ev = [str(e).strip()[:50] for e in (llm_out.get("evidence") or [])[:3] if e]
    if ev:
        base["evidence"] = ev
    return base


async def generate_swing_brief(
    code: str,
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    """波段 brief 主入口. PG TTL 建议 24 小时."""
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()
    code = str(code).strip().zfill(6)

    ctx = _load_swing_context(code, trade_date)
    if not ctx:
        return {
            "code": code,
            "name": code,
            "trade_date": trade_date.isoformat(),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "model": model_id,
            "headline": f"{code} 波段数据不足",
            "stance": "震荡",
            "trend_score": 5,
            "capital_score": 5,
            "entry_zone": "无数据",
            "exit_zone": "无数据",
            "evidence": [],
        }

    hint = _heuristic(ctx)
    system, user = _build_prompt(ctx, hint)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge(hint, llm_out)
    merged["generated_at"] = datetime.now().isoformat(timespec="seconds")
    merged["model"] = model_id
    return merged
