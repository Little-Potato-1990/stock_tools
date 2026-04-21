"""长线 AI brief —— 基于 5 年财务 + 估值分位 + 一致预期.

数据源:
- StockFundamentalsQuarterly (近 20 季)
- StockValuationDaily (当日 + 5 年分位)
- AnalystConsensusWeekly (近 4 周)
- (可选) HolderSnapshotQuarterly 主力 5 年趋势

输出:
{
  "code": "...", "name": "...", "trade_date": "...",
  "generated_at": "...", "model": "...",
  "headline": "≤30字 长线投资一句话",
  "stance": "看好|中性|谨慎|看空",
  "fundamental_score": 1-10,
  "valuation_score": 1-10,        # 越高越便宜
  "consensus_score": 1-10,        # 卖方一致预期热度
  "highlights": ["3 条 ≤40字 多维度亮点"],
  "risks": ["2 条 ≤40字 主要风险"],
  "evidence": ["3 条 ≤30字 关键数字证据"]
}

PG TTL: 7 天 (周维度刷新).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from statistics import mean
from typing import Any

from sqlalchemy import create_engine, select, desc
from sqlalchemy.orm import Session

from app.ai.brief_generator import _call_llm, _latest_trade_date_with_data
from app.ai.cross_context import NO_FLUFF_RULES
from app.config import get_settings
from app.models.stock import Stock
from app.models.fundamentals import StockFundamentalsQuarterly, StockForecastEvent
from app.models.valuation import StockValuationDaily
from app.models.consensus import AnalystConsensusWeekly
from app.models.holder import HolderSnapshotQuarterly

logger = logging.getLogger(__name__)


def _load_long_term_context(code: str, trade_date: date) -> dict[str, Any] | None:
    """同步加载长线维度上下文."""
    settings = get_settings()
    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    try:
        with Session(engine) as s:
            stock = s.execute(select(Stock).where(Stock.code == code)).scalar_one_or_none()

            funds = s.execute(
                select(StockFundamentalsQuarterly)
                .where(StockFundamentalsQuarterly.stock_code == code)
                .order_by(desc(StockFundamentalsQuarterly.report_date))
                .limit(20)
            ).scalars().all()
            funds = list(reversed(funds))

            val_today = s.execute(
                select(StockValuationDaily).where(
                    StockValuationDaily.stock_code == code,
                    StockValuationDaily.trade_date <= trade_date,
                ).order_by(desc(StockValuationDaily.trade_date)).limit(1)
            ).scalar_one_or_none()

            consensus = s.execute(
                select(AnalystConsensusWeekly)
                .where(AnalystConsensusWeekly.stock_code == code)
                .order_by(desc(AnalystConsensusWeekly.week_end))
                .limit(4)
            ).scalars().all()

            forecast = s.execute(
                select(StockForecastEvent)
                .where(
                    StockForecastEvent.stock_code == code,
                    StockForecastEvent.ann_date >= trade_date - timedelta(days=180),
                )
                .order_by(desc(StockForecastEvent.ann_date))
                .limit(4)
            ).scalars().all()

            holders = s.execute(
                select(HolderSnapshotQuarterly)
                .where(
                    HolderSnapshotQuarterly.stock_code == code,
                    HolderSnapshotQuarterly.holder_type.in_(
                        ("central_huijin", "social_security", "insurance", "qfii")
                    ),
                )
                .order_by(desc(HolderSnapshotQuarterly.report_date))
                .limit(40)
            ).scalars().all()

            if not stock and not funds and not val_today:
                return None

            recent_funds = [
                {
                    "period": f.report_date.isoformat() if f.report_date else None,
                    "revenue_yoy": f.revenue_yoy,
                    "net_profit_yoy": f.net_profit_yoy,
                    "roe": f.roe,
                    "gross_margin": f.gross_margin,
                    "net_margin": f.net_margin,
                    "debt_ratio": f.debt_ratio,
                    "ocf_to_or": f.cash_flow_op_to_revenue,
                }
                for f in funds[-8:]
            ]
            roe_5y = [f.roe for f in funds if f.roe is not None]
            roe_avg_5y = round(mean(roe_5y), 2) if roe_5y else None

            val_block = None
            if val_today:
                val_block = {
                    "trade_date": val_today.trade_date.isoformat(),
                    "pe_ttm": val_today.pe_ttm,
                    "pb": val_today.pb,
                    "ps_ttm": val_today.ps_ttm,
                    "dv_ttm": val_today.dv_ttm,
                    "total_mv_yi": round((val_today.total_mv or 0) / 1e4, 1),
                    "circ_mv_yi": round((val_today.circ_mv or 0) / 1e4, 1),
                    "pe_pct_5y": val_today.pe_pct_5y,
                    "pb_pct_5y": val_today.pb_pct_5y,
                    "pe_pct_3y": val_today.pe_pct_3y,
                    "pb_pct_3y": val_today.pb_pct_3y,
                }

            consensus_block = None
            if consensus:
                cur = consensus[0]
                consensus_block = {
                    "week_end": cur.week_end.isoformat(),
                    "target_price_avg": cur.target_price_avg,
                    "target_price_chg_4w_pct": cur.target_price_chg_4w_pct,
                    "eps_fy1": cur.eps_fy1,
                    "eps_fy1_chg_4w_pct": cur.eps_fy1_chg_4w_pct,
                    "rating_buy": cur.rating_buy or 0,
                    "rating_outperform": cur.rating_outperform or 0,
                    "rating_hold": cur.rating_hold or 0,
                    "rating_underperform": cur.rating_underperform or 0,
                    "rating_sell": cur.rating_sell or 0,
                    "report_count": cur.report_count or 0,
                    "institution_count": cur.institution_count or 0,
                }

            forecast_block = [
                {
                    "ann_date": fc.ann_date.isoformat(),
                    "period": fc.period,
                    "type": fc.type,
                    "nature": fc.nature,
                    "change_pct_low": fc.change_pct_low,
                    "change_pct_high": fc.change_pct_high,
                    "summary": (fc.summary or "")[:120],
                }
                for fc in forecast
            ]

            holder_summary: dict[str, dict] = {}
            for h in holders:
                t = h.holder_type
                if t not in holder_summary:
                    holder_summary[t] = {"latest_pct": None, "latest_date": None, "trend": []}
                if holder_summary[t]["latest_pct"] is None:
                    holder_summary[t]["latest_pct"] = h.shares_pct
                    holder_summary[t]["latest_date"] = h.report_date.isoformat()
                holder_summary[t]["trend"].append({
                    "date": h.report_date.isoformat(),
                    "type": h.change_type,
                })

            return {
                "code": code,
                "name": stock.name if stock else code,
                "industry": stock.industry if stock else None,
                "trade_date": trade_date.isoformat(),
                "fundamentals_recent_8q": recent_funds,
                "roe_avg_5y": roe_avg_5y,
                "valuation": val_block,
                "consensus_latest": consensus_block,
                "consensus_weeks_count": len(consensus),
                "forecast_recent": forecast_block,
                "holder_summary": holder_summary,
            }
    finally:
        engine.dispose()


def _heuristic_brief(ctx: dict[str, Any]) -> dict[str, Any]:
    """规则版 fallback. LLM 失败时也能输出可用结构."""
    name = ctx["name"]
    code = ctx["code"]
    val = ctx.get("valuation") or {}
    cons = ctx.get("consensus_latest") or {}
    funds = ctx.get("fundamentals_recent_8q") or []

    pe_pct = val.get("pe_pct_5y")
    roe5y = ctx.get("roe_avg_5y")

    if pe_pct is not None:
        valuation_score = max(1, min(10, round(10 - pe_pct * 10)))
    else:
        valuation_score = 5

    if roe5y is not None:
        if roe5y >= 15:
            fundamental_score = 9
        elif roe5y >= 10:
            fundamental_score = 7
        elif roe5y >= 5:
            fundamental_score = 5
        else:
            fundamental_score = 3
    else:
        fundamental_score = 5

    rating_pos = (cons.get("rating_buy") or 0) + (cons.get("rating_outperform") or 0)
    rating_neg = (cons.get("rating_underperform") or 0) + (cons.get("rating_sell") or 0)
    rating_total = rating_pos + (cons.get("rating_hold") or 0) + rating_neg
    if rating_total > 0:
        consensus_score = max(1, min(10, round(rating_pos / rating_total * 10)))
    else:
        consensus_score = 5

    if fundamental_score >= 7 and valuation_score >= 7:
        stance = "看好"
    elif fundamental_score <= 3 or valuation_score <= 3:
        stance = "看空"
    elif fundamental_score >= 6 or valuation_score >= 6:
        stance = "中性"
    else:
        stance = "谨慎"

    headline_parts = [name]
    if roe5y is not None:
        headline_parts.append(f"5Y ROE {roe5y:.1f}%")
    if pe_pct is not None:
        headline_parts.append(f"PE分位{pe_pct*100:.0f}%")
    headline = " ".join(headline_parts)[:30]

    highlights = []
    if roe5y is not None and roe5y >= 12:
        highlights.append(f"5 年平均 ROE {roe5y:.1f}% 高于行业")
    if pe_pct is not None and pe_pct < 0.3:
        highlights.append(f"PE 5 年分位仅 {pe_pct*100:.0f}% 估值偏低")
    if cons.get("target_price_chg_4w_pct") and cons["target_price_chg_4w_pct"] > 5:
        highlights.append(f"卖方目标价 4 周上修 {cons['target_price_chg_4w_pct']:.1f}%")
    if not highlights:
        highlights = ["数据不足以提炼亮点"]

    risks = []
    if funds:
        last = funds[-1]
        if (last.get("net_profit_yoy") or 0) < -10:
            risks.append(f"最新季净利同比 {last['net_profit_yoy']:.1f}% 走弱")
        if (last.get("debt_ratio") or 0) > 70:
            risks.append(f"资产负债率 {last['debt_ratio']:.0f}% 偏高")
    if pe_pct is not None and pe_pct > 0.8:
        risks.append(f"PE 5 年分位 {pe_pct*100:.0f}% 估值偏高")
    if not risks:
        risks = ["数据不足以识别风险"]

    evidence = []
    if val.get("pe_ttm"):
        evidence.append(f"PE-TTM {val['pe_ttm']:.1f}")
    if roe5y is not None:
        evidence.append(f"5Y ROE {roe5y:.1f}%")
    if cons.get("report_count"):
        evidence.append(f"近周 {cons['report_count']} 篇研报")

    return {
        "code": code,
        "name": name,
        "trade_date": ctx["trade_date"],
        "headline": headline,
        "stance": stance,
        "fundamental_score": fundamental_score,
        "valuation_score": valuation_score,
        "consensus_score": consensus_score,
        "highlights": highlights[:3],
        "risks": risks[:2],
        "evidence": evidence[:3],
    }


def _build_prompt(ctx: dict[str, Any], hint: dict) -> tuple[str, str]:
    system = (
        f"你是 A 股长线投资分析师, 评估 {ctx['name']}({ctx['code']}) 长线价值。"
        "输出严格 JSON, 综合 (a) 5年财务质量 (b) 当前估值分位 (c) 卖方一致预期 (d) 主力背书。"
        "**禁止**: 编造数据 / 给具体目标价 / 用没出现在数据里的财务数字。"
        + NO_FLUFF_RULES
    )
    user = (
        f"数据快照:\n```json\n{json.dumps(ctx, ensure_ascii=False, default=str)[:5500]}\n```\n\n"
        f"规则版预判: stance={hint['stance']}, fund={hint['fundamental_score']}, "
        f"val={hint['valuation_score']}, cons={hint['consensus_score']}\n\n"
        "请输出 JSON, schema:\n"
        "```json\n"
        "{\n"
        '  "headline": "≤30字 一句话定性 (必须含一个具体数字, 如5Y ROE/PE分位)",\n'
        '  "stance": "看好|中性|谨慎|看空",\n'
        '  "fundamental_score": 1-10 整数,\n'
        '  "valuation_score": 1-10 整数 (越高越便宜),\n'
        '  "consensus_score": 1-10 整数 (卖方一致预期热度),\n'
        '  "highlights": ["3 条 ≤40字 多维度亮点, 必须引用具体数字"],\n'
        '  "risks": ["2 条 ≤40字 主要风险"],\n'
        '  "evidence": ["3 条 ≤30字 关键数字证据"]\n'
        "}\n```\n不要 markdown fence。"
    )
    return system, user


def _merge(ctx: dict, hint: dict, llm_out: dict | None) -> dict[str, Any]:
    base = dict(hint)
    if not llm_out:
        return base

    valid_stance = {"看好", "中性", "谨慎", "看空"}
    if (h := (llm_out.get("headline") or "").strip()):
        base["headline"] = h[:50]
    if llm_out.get("stance") in valid_stance:
        base["stance"] = llm_out["stance"]

    for k in ("fundamental_score", "valuation_score", "consensus_score"):
        v = llm_out.get(k)
        if isinstance(v, (int, float)) and 1 <= v <= 10:
            base[k] = int(v)

    for k in ("highlights", "risks", "evidence"):
        items = llm_out.get(k) or []
        clean = [str(x).strip()[:60] for x in items if x]
        if clean:
            base[k] = clean[:3 if k != "risks" else 2]
    return base


async def generate_long_term_brief(
    code: str,
    trade_date: date | None = None,
    model_id: str = "deepseek-v3",
) -> dict[str, Any]:
    """长线 brief 主入口. PG TTL 建议 7 天."""
    if trade_date is None:
        trade_date = _latest_trade_date_with_data() or date.today()
    code = str(code).strip().zfill(6)

    ctx = _load_long_term_context(code, trade_date)
    if not ctx:
        return {
            "code": code,
            "name": code,
            "trade_date": trade_date.isoformat(),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "model": model_id,
            "headline": f"{code} 长线数据不足",
            "stance": "中性",
            "fundamental_score": 5,
            "valuation_score": 5,
            "consensus_score": 5,
            "highlights": [],
            "risks": ["缺少财务/估值/一致预期数据"],
            "evidence": [],
        }

    hint = _heuristic_brief(ctx)
    system, user = _build_prompt(ctx, hint)
    llm_out = await _call_llm(system, user, model_id)
    merged = _merge(ctx, hint, llm_out)
    merged["generated_at"] = datetime.now().isoformat(timespec="seconds")
    merged["model"] = model_id
    return merged
