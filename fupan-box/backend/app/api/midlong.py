"""中长视角 (Mid-Long Perspective) HTTP 端点 — Phase 3.

挂在 /api/midlong 前缀, 给「中长视角独立页 5 Tab」+ 个股 Drawer 长线标签页用.

端点列表:
- GET /fundamentals/{code}    - 财务: 近 N 季度 fina_indicator + 最新预告事件
- GET /valuation/{code}       - 估值: PE/PB 时序 + 5y/3y 分位
- GET /consensus/{code}       - 卖方一致预期: 周时序 + 评级分布
- GET /holders/{code}         - 持仓变动: 近 N 季度十大股东 (复用 HolderSnapshotQuarterly)
- GET /long-brief/{code}      - AI 长线 brief (cache + lazy gen)
- GET /screener               - 估值/财务筛选榜 (低估/高 ROE/上修目标价)

匿名可读 (Phase 1 限流), brief 写入路径有 quota.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.brief_cache import cached_brief, invalidate_pg
from app.ai.long_term_brief import generate_long_term_brief
from app.api._cache import invalidate as invalidate_mem
from app.api.auth import optional_user
from app.database import get_db
from app.models.consensus import AnalystConsensusWeekly
from app.models.fundamentals import StockFundamentalsQuarterly, StockForecastEvent
from app.models.holder import HolderSnapshotQuarterly
from app.models.user import User
from app.models.valuation import StockValuationDaily

router = APIRouter()

PG_TTL_H_LONG = 24.0 * 7  # 长线 brief 缓存 7 天

# 估值历史窗口的分层上限 (交易日数)
#   anonymous (无 user)    : 60 日 (≈3 月) - 引导注册
#   free                    : 250 日 (≈1 年)
#   monthly / yearly        : 1250 日 (≈5 年) 完整估值回看
TIER_VALUATION_DAYS_CAP: dict[str, int] = {
    "anonymous": 60,
    "free": 250,
    "monthly": 1250,
    "yearly": 1250,
}

# 历史回看 (consensus / fundamentals / holders) 的分层上限
TIER_HISTORY_CAP: dict[str, dict[str, int]] = {
    "anonymous": {"consensus_weeks": 8, "fundamentals_periods": 4, "holders_quarters": 2, "screener_limit": 20},
    "free":       {"consensus_weeks": 26, "fundamentals_periods": 8, "holders_quarters": 4, "screener_limit": 50},
    "monthly":    {"consensus_weeks": 104, "fundamentals_periods": 20, "holders_quarters": 12, "screener_limit": 200},
    "yearly":     {"consensus_weeks": 104, "fundamentals_periods": 20, "holders_quarters": 12, "screener_limit": 500},
}


def _tier_of(user: User | None) -> str:
    if user is None:
        return "anonymous"
    return user.tier or "free"


def _tier_meta(tier: str) -> dict:
    return {
        "tier": tier,
        "valuation_days_cap": TIER_VALUATION_DAYS_CAP.get(tier, TIER_VALUATION_DAYS_CAP["anonymous"]),
        "history_cap": TIER_HISTORY_CAP.get(tier, TIER_HISTORY_CAP["anonymous"]),
        "upgrade_hint": (
            "升级 Pro/Master 解锁完整 5 年估值回看 + 全部历史财报"
            if tier in ("anonymous", "free") else None
        ),
    }


# ----------------------------------------------------------
# 1) 财务面板
# ----------------------------------------------------------

@router.get("/fundamentals/{code}")
async def get_fundamentals(
    code: str,
    periods: int = Query(8, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict[str, Any]:
    """近 N 季度核心财务指标 + 最新业绩预告/快报事件.

    分层访问:
      - anonymous: 最多 4 季度
      - free:      最多 8 季度
      - paid:      完整 20 季度 (5 年)
    """
    tier = _tier_of(user)
    cap = TIER_HISTORY_CAP[tier]["fundamentals_periods"]
    effective_periods = min(periods, cap)
    quarterly_q = (
        select(StockFundamentalsQuarterly)
        .where(StockFundamentalsQuarterly.stock_code == code)
        .order_by(StockFundamentalsQuarterly.report_date.desc())
        .limit(effective_periods)
    )
    res = await db.execute(quarterly_q)
    rows = list(reversed(res.scalars().all()))  # 升序输出
    quarterly = [
        {
            "report_date": r.report_date.isoformat(),
            "revenue": r.revenue,
            "revenue_yoy": r.revenue_yoy,
            "net_profit": r.net_profit,
            "net_profit_yoy": r.net_profit_yoy,
            "gross_margin": r.gross_margin,
            "net_margin": r.net_margin,
            "roe": r.roe,
            "roa": r.roa,
            "debt_ratio": r.debt_ratio,
            "current_ratio": r.current_ratio,
            "cash_flow_op": r.cash_flow_op,
            "cash_flow_op_to_revenue": r.cash_flow_op_to_revenue,
            "eps": r.eps,
            "bps": r.bps,
            "ann_date": r.ann_date.isoformat() if r.ann_date else None,
        }
        for r in rows
    ]

    forecast_q = (
        select(StockForecastEvent)
        .where(StockForecastEvent.stock_code == code)
        .order_by(StockForecastEvent.ann_date.desc())
        .limit(8)
    )
    res2 = await db.execute(forecast_q)
    forecast_rows = res2.scalars().all()
    forecasts = [
        {
            "ann_date": r.ann_date.isoformat(),
            "period": r.period,
            "type": r.type,
            "nature": r.nature,
            "change_pct_low": r.change_pct_low,
            "change_pct_high": r.change_pct_high,
            "net_profit_low": r.net_profit_low,
            "net_profit_high": r.net_profit_high,
            "summary": r.summary,
        }
        for r in forecast_rows
    ]

    return {
        "stock_code": code,
        "quarterly": quarterly,
        "forecast": forecasts,
        "count": len(quarterly),
        "tier_meta": _tier_meta(tier),
    }


# ----------------------------------------------------------
# 2) 估值分位
# ----------------------------------------------------------

@router.get("/valuation/{code}")
async def get_valuation(
    code: str,
    days: int = Query(250, ge=1, le=1500, description="历史窗口, 默认 1 年≈250 交易日, 付费用户可拉到 1250"),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict[str, Any]:
    """PE/PB 时序 + 当日 5y/3y 分位 + 总市值.

    分层访问:
      - anonymous: 60 交易日 (3 月)
      - free:      250 交易日 (1 年)
      - paid:      1250 交易日 (5 年, 完整估值回看)
    """
    tier = _tier_of(user)
    cap = TIER_VALUATION_DAYS_CAP[tier]
    effective_days = min(days, cap)
    q = (
        select(StockValuationDaily)
        .where(StockValuationDaily.stock_code == code)
        .order_by(StockValuationDaily.trade_date.desc())
        .limit(effective_days)
    )
    res = await db.execute(q)
    rows = list(reversed(res.scalars().all()))
    if not rows:
        return {"stock_code": code, "series": [], "latest": None, "count": 0, "tier_meta": _tier_meta(tier)}

    series = [
        {
            "trade_date": r.trade_date.isoformat(),
            "pe": r.pe,
            "pe_ttm": r.pe_ttm,
            "pb": r.pb,
            "ps_ttm": r.ps_ttm,
            "dv_ttm": r.dv_ttm,
            "total_mv": r.total_mv,
            "circ_mv": r.circ_mv,
        }
        for r in rows
    ]
    latest = rows[-1]
    return {
        "stock_code": code,
        "series": series,
        "latest": {
            "trade_date": latest.trade_date.isoformat(),
            "pe": latest.pe,
            "pe_ttm": latest.pe_ttm,
            "pb": latest.pb,
            "ps_ttm": latest.ps_ttm,
            "dv_ttm": latest.dv_ttm,
            "pe_pct_5y": latest.pe_pct_5y,
            "pe_pct_3y": latest.pe_pct_3y,
            "pb_pct_5y": latest.pb_pct_5y,
            "pb_pct_3y": latest.pb_pct_3y,
            "total_mv": latest.total_mv,
            "circ_mv": latest.circ_mv,
        },
        "count": len(series),
        "tier_meta": _tier_meta(tier),
    }


# ----------------------------------------------------------
# 3) 卖方一致预期
# ----------------------------------------------------------

@router.get("/consensus/{code}")
async def get_consensus(
    code: str,
    weeks: int = Query(26, ge=1, le=104),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict[str, Any]:
    """近 N 周一致预期 + 当周评级分布 + 4 周目标价/EPS 变化方向.

    分层访问:
      - anonymous:  8 周
      - free:      26 周 (半年)
      - paid:     104 周 (2 年)
    """
    tier = _tier_of(user)
    cap = TIER_HISTORY_CAP[tier]["consensus_weeks"]
    effective_weeks = min(weeks, cap)
    q = (
        select(AnalystConsensusWeekly)
        .where(AnalystConsensusWeekly.stock_code == code)
        .order_by(AnalystConsensusWeekly.week_end.desc())
        .limit(effective_weeks)
    )
    res = await db.execute(q)
    rows = list(reversed(res.scalars().all()))
    if not rows:
        return {"stock_code": code, "series": [], "latest": None, "count": 0, "tier_meta": _tier_meta(tier)}

    series = [
        {
            "week_end": r.week_end.isoformat(),
            "target_price_avg": r.target_price_avg,
            "target_price_median": r.target_price_median,
            "target_price_chg_4w_pct": r.target_price_chg_4w_pct,
            "eps_fy1": r.eps_fy1,
            "eps_fy1_chg_4w_pct": r.eps_fy1_chg_4w_pct,
            "report_count": r.report_count,
        }
        for r in rows
    ]
    latest = rows[-1]
    return {
        "stock_code": code,
        "series": series,
        "latest": {
            "week_end": latest.week_end.isoformat(),
            "target_price_avg": latest.target_price_avg,
            "target_price_median": latest.target_price_median,
            "target_price_min": latest.target_price_min,
            "target_price_max": latest.target_price_max,
            "target_price_chg_4w_pct": latest.target_price_chg_4w_pct,
            "eps_fy1": latest.eps_fy1,
            "eps_fy2": latest.eps_fy2,
            "eps_fy3": latest.eps_fy3,
            "eps_fy1_chg_4w_pct": latest.eps_fy1_chg_4w_pct,
            "rating": {
                "buy": latest.rating_buy or 0,
                "outperform": latest.rating_outperform or 0,
                "hold": latest.rating_hold or 0,
                "underperform": latest.rating_underperform or 0,
                "sell": latest.rating_sell or 0,
            },
            "report_count": latest.report_count,
            "institution_count": latest.institution_count,
        },
        "count": len(series),
        "tier_meta": _tier_meta(tier),
    }


# ----------------------------------------------------------
# 4) 主力持仓追踪 (复用 holder_snapshot_quarterly)
# ----------------------------------------------------------

@router.get("/holders/{code}")
async def get_long_holders(
    code: str,
    quarters: int = Query(4, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict[str, Any]:
    """近 N 季度十大股东 (含流通) + 变动汇总, 给中长视角持仓追踪 Tab 用.

    返回 by_period: 每季度按 rank 排序的股东列表;
    summary: 当季新进/增持/减持/退出汇总.

    分层访问:
      - anonymous: 2 季度
      - free:      4 季度
      - paid:     12 季度 (3 年完整跟踪)
    """
    tier = _tier_of(user)
    cap = TIER_HISTORY_CAP[tier]["holders_quarters"]
    effective_quarters = min(quarters, cap)
    rd_q = (
        select(HolderSnapshotQuarterly.report_date)
        .where(HolderSnapshotQuarterly.stock_code == code)
        .group_by(HolderSnapshotQuarterly.report_date)
        .order_by(HolderSnapshotQuarterly.report_date.desc())
        .limit(effective_quarters)
    )
    res = await db.execute(rd_q)
    report_dates = [r[0] for r in res.all()]
    if not report_dates:
        return {"stock_code": code, "by_period": [], "summary": None, "tier_meta": _tier_meta(tier)}

    holders_q = (
        select(HolderSnapshotQuarterly)
        .where(
            HolderSnapshotQuarterly.stock_code == code,
            HolderSnapshotQuarterly.report_date.in_(report_dates),
        )
        .order_by(
            HolderSnapshotQuarterly.report_date.desc(),
            HolderSnapshotQuarterly.is_free_float,
            HolderSnapshotQuarterly.rank,
        )
    )
    res2 = await db.execute(holders_q)
    rows = res2.scalars().all()

    by_period: dict[str, list[dict]] = {}
    for r in rows:
        k = r.report_date.isoformat()
        by_period.setdefault(k, []).append({
            "holder_name": r.holder_name,
            "canonical_name": r.canonical_name,
            "holder_type": r.holder_type,
            "fund_company": r.fund_company,
            "is_free_float": r.is_free_float,
            "rank": r.rank,
            "change_type": r.change_type,
        })

    latest_rd = report_dates[0].isoformat()
    summary = {"new": 0, "add": 0, "reduce": 0, "exit": 0}
    for h in by_period.get(latest_rd, []):
        ct = h.get("change_type")
        if ct in summary:
            summary[ct] += 1

    return {
        "stock_code": code,
        "by_period": [
            {"report_date": rd.isoformat(), "holders": by_period.get(rd.isoformat(), [])}
            for rd in report_dates
        ],
        "latest_summary": summary,
        "tier_meta": _tier_meta(tier),
    }


# ----------------------------------------------------------
# 5) AI 长线 brief
# ----------------------------------------------------------

@router.get("/long-brief/{code}")
async def get_long_brief(
    code: str,
    trade_date: date | None = Query(None),
    model: str = Query("deepseek-v3"),
    refresh: int = Query(0),
):
    """长线 AI brief, 7 天缓存 (估值/业绩/一致预期变化慢)."""
    td = trade_date or date.today()
    key = f"long_term_brief:{code}:{td.isoformat()}:{model}"
    if refresh:
        invalidate_mem(f"long_term_brief:{code}")
        invalidate_pg(key)
    return await cached_brief(
        key, generate_long_term_brief, code, td, model,
        action="long_term_brief", model=model, trade_date=td,
        pg_ttl_h=PG_TTL_H_LONG, refresh=bool(refresh),
    )


# ----------------------------------------------------------
# 6) 估值/财务筛选榜
# ----------------------------------------------------------

_SCREENER_METRICS = {
    "low_pe_pct_5y": (StockValuationDaily.pe_pct_5y, False),    # 低估值: pe 分位升序
    "low_pb_pct_5y": (StockValuationDaily.pb_pct_5y, False),
    "high_total_mv": (StockValuationDaily.total_mv, True),
    "high_dv_ttm": (StockValuationDaily.dv_ttm, True),
}


@router.get("/screener")
async def screener(
    metric: str = Query("low_pe_pct_5y", description=f"one of {list(_SCREENER_METRICS.keys())}"),
    limit: int = Query(50, ge=1, le=500),
    min_total_mv: float | None = Query(None, description="最小总市值 (万元)"),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict[str, Any]:
    """筛选榜单: 用最新一期估值数据.

    分层访问:
      - anonymous:  20 行
      - free:       50 行
      - paid:      500 行 (完整全市场)
    """
    if metric not in _SCREENER_METRICS:
        raise HTTPException(400, f"unknown metric, supported: {list(_SCREENER_METRICS.keys())}")

    tier = _tier_of(user)
    cap = TIER_HISTORY_CAP[tier]["screener_limit"]
    effective_limit = min(limit, cap)

    latest_dt_q = select(func.max(StockValuationDaily.trade_date))
    res = await db.execute(latest_dt_q)
    td = res.scalar_one_or_none()
    if not td:
        return {"items": [], "tier_meta": _tier_meta(tier)}

    col, descending = _SCREENER_METRICS[metric]
    q = (
        select(StockValuationDaily)
        .where(
            StockValuationDaily.trade_date == td,
            col.isnot(None),
        )
    )
    if min_total_mv is not None:
        q = q.where(StockValuationDaily.total_mv >= min_total_mv)
    q = q.order_by(desc(col) if descending else col).limit(effective_limit)

    res2 = await db.execute(q)
    rows = res2.scalars().all()
    items = [
        {
            "stock_code": r.stock_code,
            "trade_date": r.trade_date.isoformat(),
            "pe_ttm": r.pe_ttm,
            "pb": r.pb,
            "pe_pct_5y": r.pe_pct_5y,
            "pb_pct_5y": r.pb_pct_5y,
            "dv_ttm": r.dv_ttm,
            "total_mv": r.total_mv,
        }
        for r in rows
    ]
    return {"items": items, "tier_meta": _tier_meta(tier)}
