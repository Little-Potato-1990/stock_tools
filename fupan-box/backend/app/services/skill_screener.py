"""体系驱动的选股扫描器.

主流程:
  1. resolve_universe(universe) → list[stock_code]
  2. apply_filters(rules.filters, codes) → SQL 多表 JOIN 硬过滤 → list[passed]
  3. compute_factors + apply_scorers(rules.scorers, passed) → 加权打分
  4. 排序取 top_n → list[Candidate(code, name, score, factor_hits, base_data)]

screener 不调 LLM，LLM 解读由 skill_scan API 在 screener 之上单独跑（流式）。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, create_engine, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.fundamentals import StockFundamentalsQuarterly
from app.models.industry import Industry, IndustryStock
from app.models.market import LimitUpRecord
from app.models.stock import DailyQuote, Stock
from app.models.theme import Theme, ThemeStock
from app.models.user import UserWatchlist
from app.models.valuation import StockValuationDaily
from app.services.skill_factors import FactorBundle, compute_factors

logger = logging.getLogger(__name__)


def _engine():
    return create_engine(get_settings().database_url_sync, pool_pre_ping=True)


@dataclass
class Candidate:
    code: str
    name: str = ""
    industry: str = ""
    score: float = 0.0
    factor_hits: list[dict[str, Any]] = field(default_factory=list)
    base_data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "name": self.name,
            "industry": self.industry,
            "score": round(self.score, 3),
            "factor_hits": self.factor_hits,
            "base_data": self.base_data,
        }


@dataclass
class ScreenerResult:
    universe: str
    universe_size: int
    pre_filter_count: int     # 硬过滤通过数
    final_count: int
    candidates: list[Candidate]
    trade_date: date


# ============== universe 解析 ==============


def _resolve_universe(session: Session, universe: str, user_id: int | None) -> list[str]:
    universe = (universe or "").strip()
    if universe == "all":
        rows = session.execute(select(Stock.code)).all()
        return [r[0] for r in rows]

    if universe == "watchlist":
        if not user_id:
            return []
        rows = session.execute(
            select(UserWatchlist.stock_code).where(UserWatchlist.user_id == user_id)
        ).all()
        return [r[0] for r in rows]

    if universe == "hs300":
        # 尝试从 themes 找 "沪深300" 成分；找不到退化为全市场（warn 由调用方处理）
        for nm in ("沪深300", "HS300", "沪深 300", "HS 300"):
            theme = session.execute(select(Theme).where(Theme.name == nm)).scalar_one_or_none()
            if theme:
                rows = session.execute(
                    select(ThemeStock.stock_code).where(ThemeStock.theme_id == theme.id)
                ).all()
                if rows:
                    return [r[0] for r in rows]
        logger.warning("hs300 theme not found, falling back to 'all'")
        return _resolve_universe(session, "all", user_id)

    if universe.startswith("industry:"):
        name = universe[len("industry:"):].strip()
        if not name:
            return []
        ind = session.execute(select(Industry).where(Industry.name == name)).scalar_one_or_none()
        if not ind:
            return []
        rows = session.execute(
            select(IndustryStock.stock_code).where(IndustryStock.industry_id == ind.id)
        ).all()
        return [r[0] for r in rows]

    if universe.startswith("theme:"):
        name = universe[len("theme:"):].strip()
        if not name:
            return []
        theme = session.execute(select(Theme).where(Theme.name == name)).scalar_one_or_none()
        if not theme:
            return []
        rows = session.execute(
            select(ThemeStock.stock_code).where(ThemeStock.theme_id == theme.id)
        ).all()
        return [r[0] for r in rows]

    logger.warning("unknown universe '%s'", universe)
    return []


def _latest_valuation_date(session: Session, trade_date: date) -> date | None:
    """估值表的最新交易日 ≤ trade_date。"""
    res = session.execute(
        select(func.max(StockValuationDaily.trade_date))
        .where(StockValuationDaily.trade_date <= trade_date)
    ).scalar_one_or_none()
    return res


def _latest_fund_per_stock(session: Session, codes: list[str]) -> dict[str, StockFundamentalsQuarterly]:
    """每只股票最新一期的 fundamentals quarterly。批量取，避免 N+1。"""
    if not codes:
        return {}
    sub = (
        select(
            StockFundamentalsQuarterly.stock_code,
            func.max(StockFundamentalsQuarterly.report_date).label("max_dt"),
        )
        .where(StockFundamentalsQuarterly.stock_code.in_(codes))
        .group_by(StockFundamentalsQuarterly.stock_code)
        .subquery()
    )
    rows = session.execute(
        select(StockFundamentalsQuarterly).join(
            sub,
            and_(
                StockFundamentalsQuarterly.stock_code == sub.c.stock_code,
                StockFundamentalsQuarterly.report_date == sub.c.max_dt,
            ),
        )
    ).scalars().all()
    return {r.stock_code: r for r in rows}


def _avg_roe_3y(session: Session, codes: list[str]) -> dict[str, float]:
    """近 3 年(≈12 个季度) ROE 平均。"""
    if not codes:
        return {}
    cutoff = date.today() - timedelta(days=365 * 3 + 90)
    rows = session.execute(
        select(
            StockFundamentalsQuarterly.stock_code,
            func.avg(StockFundamentalsQuarterly.roe).label("avg_roe"),
        )
        .where(
            StockFundamentalsQuarterly.stock_code.in_(codes),
            StockFundamentalsQuarterly.report_date >= cutoff,
            StockFundamentalsQuarterly.roe.is_not(None),
        )
        .group_by(StockFundamentalsQuarterly.stock_code)
    ).all()
    return {r[0]: float(r[1]) for r in rows if r[1] is not None}


# ============== 硬过滤 ==============


def _apply_filters(
    session: Session,
    codes: list[str],
    filters: dict[str, Any],
    trade_date: date,
) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """对 codes 应用 filters，返回 (passed_codes, base_data_per_code)。

    base_data 包含 name / industry / 估值快照 / 财务快照，给后续打分 + 前端展示。
    """
    if not codes:
        return [], {}

    # 1) 基础信息 + ST 过滤
    stocks_q = select(Stock).where(Stock.code.in_(codes))
    if filters.get("exclude_st"):
        stocks_q = stocks_q.where(Stock.is_st == False)  # noqa: E712
    stock_rows = session.execute(stocks_q).scalars().all()
    base: dict[str, dict[str, Any]] = {
        s.code: {"name": s.name, "industry": s.industry or "", "is_st": s.is_st}
        for s in stock_rows
    }
    codes = list(base.keys())
    if not codes:
        return [], {}

    # 2) 行业过滤
    ind_in = filters.get("industry_in") or []
    ind_not = filters.get("industry_not_in") or []
    if ind_in:
        ind_in_set = set(ind_in)
        codes = [c for c in codes if base[c]["industry"] in ind_in_set]
    if ind_not:
        ind_not_set = set(ind_not)
        codes = [c for c in codes if base[c]["industry"] not in ind_not_set]
    if not codes:
        return [], {}

    # 3) 题材过滤
    theme_in = filters.get("theme_in") or []
    theme_not = filters.get("theme_not_in") or []
    if theme_in or theme_not:
        # code → set(theme_name)
        join = (
            select(ThemeStock.stock_code, Theme.name)
            .join(Theme, Theme.id == ThemeStock.theme_id)
            .where(ThemeStock.stock_code.in_(codes))
        )
        themes_per_code: dict[str, set[str]] = {}
        for code, name in session.execute(join).all():
            themes_per_code.setdefault(code, set()).add(name)
        if theme_in:
            ti = set(theme_in)
            codes = [c for c in codes if themes_per_code.get(c, set()) & ti]
        if theme_not:
            tn = set(theme_not)
            codes = [c for c in codes if not (themes_per_code.get(c, set()) & tn)]
    if not codes:
        return [], {}

    # 4) 估值 + 市值过滤 (按最新可用 valuation 日期)
    val_date = _latest_valuation_date(session, trade_date)
    val_map: dict[str, StockValuationDaily] = {}
    if val_date:
        val_rows = session.execute(
            select(StockValuationDaily).where(
                StockValuationDaily.trade_date == val_date,
                StockValuationDaily.stock_code.in_(codes),
            )
        ).scalars().all()
        val_map = {v.stock_code: v for v in val_rows}

    val_filters_keys = (
        "pe_ttm_max", "pe_ttm_min", "pb_max", "pb_min",
        "pe_ttm_pct_5y_max", "pe_ttm_pct_5y_min",
        "dividend_yield_min", "market_cap_yi_max", "market_cap_yi_min",
    )
    has_val_filter = any(k in filters for k in val_filters_keys)

    def _val_pass(c: str) -> bool:
        if not has_val_filter:
            return True
        v = val_map.get(c)
        if not v:
            return False  # 没估值数据直接出局（避免误推荐）
        if "pe_ttm_max" in filters and (v.pe_ttm is None or v.pe_ttm > filters["pe_ttm_max"]):
            return False
        if "pe_ttm_min" in filters and (v.pe_ttm is None or v.pe_ttm < filters["pe_ttm_min"]):
            return False
        if "pb_max" in filters and (v.pb is None or v.pb > filters["pb_max"]):
            return False
        if "pb_min" in filters and (v.pb is None or v.pb < filters["pb_min"]):
            return False
        if "pe_ttm_pct_5y_max" in filters and (
            v.pe_pct_5y is None or v.pe_pct_5y * 100 > filters["pe_ttm_pct_5y_max"]
        ):
            return False
        if "pe_ttm_pct_5y_min" in filters and (
            v.pe_pct_5y is None or v.pe_pct_5y * 100 < filters["pe_ttm_pct_5y_min"]
        ):
            return False
        if "dividend_yield_min" in filters and (
            v.dv_ratio is None or v.dv_ratio < filters["dividend_yield_min"]
        ):
            return False
        # 市值: total_mv 单位为万元；转换为亿
        if "market_cap_yi_max" in filters or "market_cap_yi_min" in filters:
            cap_yi = (v.total_mv or 0) / 10000.0
            if "market_cap_yi_max" in filters and cap_yi > filters["market_cap_yi_max"]:
                return False
            if "market_cap_yi_min" in filters and cap_yi < filters["market_cap_yi_min"]:
                return False
        return True

    codes = [c for c in codes if _val_pass(c)]
    if not codes:
        return [], {}

    # 5) 财务过滤
    fund_keys = ("roe_latest_min", "roe_3y_avg_min", "net_profit_yoy_min", "revenue_yoy_min")
    has_fund_filter = any(k in filters for k in fund_keys)
    fund_map: dict[str, StockFundamentalsQuarterly] = {}
    avg_roe_map: dict[str, float] = {}
    if has_fund_filter:
        fund_map = _latest_fund_per_stock(session, codes)
        if "roe_3y_avg_min" in filters:
            avg_roe_map = _avg_roe_3y(session, codes)

        def _fund_pass(c: str) -> bool:
            f = fund_map.get(c)
            if not f and ("roe_latest_min" in filters or "net_profit_yoy_min" in filters or "revenue_yoy_min" in filters):
                return False
            if "roe_latest_min" in filters and (f.roe is None or f.roe < filters["roe_latest_min"]):
                return False
            if "net_profit_yoy_min" in filters and (
                f.net_profit_yoy is None or f.net_profit_yoy < filters["net_profit_yoy_min"]
            ):
                return False
            if "revenue_yoy_min" in filters and (
                f.revenue_yoy is None or f.revenue_yoy < filters["revenue_yoy_min"]
            ):
                return False
            if "roe_3y_avg_min" in filters and avg_roe_map.get(c, -1e9) < filters["roe_3y_avg_min"]:
                return False
            return True

        codes = [c for c in codes if _fund_pass(c)]
    else:
        # 即使不过滤，也提前装载用于后续打分
        fund_map = _latest_fund_per_stock(session, codes)
        avg_roe_map = _avg_roe_3y(session, codes)

    if not codes:
        return [], {}

    # 6) 当日状态 (涨停 / 连板) 过滤
    if filters.get("exclude_limit_up_today"):
        rows = session.execute(
            select(DailyQuote.stock_code).where(
                DailyQuote.stock_code.in_(codes),
                DailyQuote.trade_date == trade_date,
                DailyQuote.is_limit_up == True,  # noqa: E712
            )
        ).all()
        excluded = {r[0] for r in rows}
        codes = [c for c in codes if c not in excluded]
    if filters.get("exclude_recent_continuous_limit_up") and codes:
        cutoff = trade_date - timedelta(days=10)
        rows = session.execute(
            select(LimitUpRecord.stock_code).where(
                LimitUpRecord.stock_code.in_(codes),
                LimitUpRecord.trade_date >= cutoff,
                LimitUpRecord.continuous_days >= 2,
            )
        ).all()
        excluded = {r[0] for r in rows}
        codes = [c for c in codes if c not in excluded]
    if not codes:
        return [], {}

    # 7) 技术过滤（MA / 突破 / 涨幅）
    tech_keys = (
        "above_ma60", "ma_bull_arrangement", "break_n_day_high",
        "pullback_to_ma20", "recent_n_day_pct_min", "recent_n_day_pct_max",
    )
    has_tech_filter = any(k in filters for k in tech_keys)
    factors_map: dict[str, FactorBundle] = {}
    if has_tech_filter:
        factors_map = compute_factors(session, codes, trade_date)

        def _tech_pass(c: str) -> bool:
            fb = factors_map.get(c) or FactorBundle(code=c)
            if filters.get("above_ma60") and not fb.above_ma60:
                return False
            if filters.get("ma_bull_arrangement") and not fb.ma_bull_arrangement:
                return False
            if "break_n_day_high" in filters:
                # 简单实现：用 60 日新高
                if not fb.break_60_day_high:
                    return False
            if filters.get("pullback_to_ma20") and not fb.pullback_to_ma20:
                return False
            spec_min = filters.get("recent_n_day_pct_min")
            if isinstance(spec_min, dict):
                n = spec_min.get("n") or 20
                threshold = spec_min.get("min")
                pct = _pick_recent_pct(fb, n)
                if threshold is not None and (pct is None or pct < threshold):
                    return False
            spec_max = filters.get("recent_n_day_pct_max")
            if isinstance(spec_max, dict):
                n = spec_max.get("n") or 20
                threshold = spec_max.get("max")
                pct = _pick_recent_pct(fb, n)
                if threshold is not None and (pct is None or pct > threshold):
                    return False
            return True

        codes = [c for c in codes if _tech_pass(c)]
    else:
        # 后续打分可能用到，预热（只在候选数 < 800 时算，避免一次太多）
        if len(codes) <= 800:
            factors_map = compute_factors(session, codes, trade_date)

    # 组装 base_data，给后续 scorers + 前端用
    out_base: dict[str, dict[str, Any]] = {}
    for c in codes:
        v = val_map.get(c)
        f = fund_map.get(c)
        fb = factors_map.get(c)
        out_base[c] = {
            **base.get(c, {}),
            "valuation": {
                "pe_ttm": v.pe_ttm if v else None,
                "pb": v.pb if v else None,
                "pe_pct_5y_pct": (v.pe_pct_5y * 100 if v and v.pe_pct_5y is not None else None),
                "dv_ratio": v.dv_ratio if v else None,
                "total_mv_yi": (v.total_mv / 10000.0) if v and v.total_mv else None,
            } if v else None,
            "fundamentals": {
                "report_date": str(f.report_date) if f else None,
                "roe": f.roe if f else None,
                "net_profit_yoy": f.net_profit_yoy if f else None,
                "revenue_yoy": f.revenue_yoy if f else None,
                "roe_3y_avg": avg_roe_map.get(c),
            } if f else {"roe_3y_avg": avg_roe_map.get(c)},
            "factors": fb.to_dict() if fb else None,
        }

    return codes, out_base


def _pick_recent_pct(fb: FactorBundle, n: int) -> float | None:
    if n <= 5:
        return fb.pct_5d
    if n <= 20:
        return fb.pct_20d
    return fb.pct_60d


# ============== 软评分 ==============


def _score_one(
    code: str, base: dict[str, Any], scorers: list[dict[str, Any]]
) -> tuple[float, list[dict[str, Any]]]:
    """单只股票打分。返回 (score, hits)，hits 用于前端展示命中因子。"""
    if not scorers:
        return 0.0, []

    val = base.get("valuation") or {}
    fund = base.get("fundamentals") or {}
    factors = base.get("factors") or {}

    score = 0.0
    hits: list[dict[str, Any]] = []

    for s in scorers:
        f = s.get("factor")
        w = float(s.get("weight", 1))

        # 因子值 → [0,1] 归一化贡献
        contrib: float | None = None
        label: str | None = None
        if f == "low_pe_pct_5y" and val.get("pe_pct_5y_pct") is not None:
            contrib = max(0.0, (100 - val["pe_pct_5y_pct"]) / 100)
            label = f"PE 5年分位 {val['pe_pct_5y_pct']:.0f}%"
        elif f == "high_dividend_yield" and val.get("dv_ratio") is not None:
            # 0%-7% 线性
            contrib = max(0.0, min(1.0, val["dv_ratio"] / 7.0))
            label = f"股息率 {val['dv_ratio']:.2f}%"
        elif f == "high_roe" and (fund.get("roe") is not None):
            contrib = max(0.0, min(1.0, fund["roe"] / 25.0))
            label = f"ROE {fund['roe']:.1f}%"
        elif f == "low_pe_in_industry" and val.get("pe_ttm") is not None and val["pe_ttm"] > 0:
            contrib = max(0.0, min(1.0, 30.0 / val["pe_ttm"]))
            label = f"PE-TTM {val['pe_ttm']:.1f}"
        elif f == "low_pb_in_industry" and val.get("pb") is not None and val["pb"] > 0:
            contrib = max(0.0, min(1.0, 3.0 / val["pb"]))
            label = f"PB {val['pb']:.2f}"
        elif f == "rising_revenue_3y" and (fund.get("revenue_yoy") is not None):
            contrib = max(0.0, min(1.0, fund["revenue_yoy"] / 30.0))
            label = f"营收同比 {fund['revenue_yoy']:.1f}%"
        elif f == "rising_profit_3y" and (fund.get("net_profit_yoy") is not None):
            contrib = max(0.0, min(1.0, fund["net_profit_yoy"] / 50.0))
            label = f"净利同比 {fund['net_profit_yoy']:.1f}%"
        elif f == "high_market_cap" and val.get("total_mv_yi") is not None:
            # > 1000 亿满分
            contrib = max(0.0, min(1.0, val["total_mv_yi"] / 1000.0))
            label = f"总市值 {val['total_mv_yi']:.0f}亿"
        elif f == "low_market_cap" and val.get("total_mv_yi") is not None:
            contrib = max(0.0, min(1.0, 100.0 / max(10.0, val["total_mv_yi"])))
            label = f"总市值 {val['total_mv_yi']:.0f}亿"
        elif f == "ma_bull_arrangement" and factors.get("ma_bull_arrangement"):
            contrib = 1.0
            label = "均线多头排列"
        elif f == "above_ma60" and factors.get("above_ma60"):
            contrib = 1.0
            label = "站上 MA60"
        elif f == "near_ma20_pullback" and factors.get("pullback_to_ma20"):
            contrib = 1.0
            label = "回踩 MA20"
        elif f == "recent_breakout" and factors.get("break_60_day_high"):
            contrib = 1.0
            label = "突破 60 日新高"

        if contrib is not None and contrib > 0:
            score += contrib * w
            hits.append({"factor": f, "weight": w, "contrib": round(contrib * w, 3), "label": label})

    return score, hits


def run_scan(
    user_id: int | None,
    derived_rules: dict[str, Any],
    universe: str,
    top_n: int,
    trade_date: date | None = None,
) -> ScreenerResult:
    """同步入口：跑一次扫描，返回按分数倒排的 top_n 候选股。"""
    rules = derived_rules or {}
    filters = rules.get("filters") or {}
    scorers = rules.get("scorers") or []
    universe = universe or rules.get("scan_universe_default") or "hs300"
    if not trade_date:
        trade_date = date.today()
    top_n = max(5, min(100, int(top_n or rules.get("top_n_suggested") or 30)))

    engine = _engine()
    try:
        with Session(engine) as s:
            uni_codes = _resolve_universe(s, universe, user_id)
            uni_size = len(uni_codes)
            if not uni_codes:
                return ScreenerResult(universe, 0, 0, 0, [], trade_date)

            # 大候选集分批 filter（避免一次 IN 太大）
            batch = 800
            passed_codes: list[str] = []
            base_map: dict[str, dict[str, Any]] = {}
            for i in range(0, len(uni_codes), batch):
                chunk = uni_codes[i : i + batch]
                p, b = _apply_filters(s, chunk, filters, trade_date)
                passed_codes.extend(p)
                base_map.update(b)

            pre_filter_count = len(passed_codes)
            if not passed_codes:
                return ScreenerResult(universe, uni_size, 0, 0, [], trade_date)

            # 评分
            scored: list[Candidate] = []
            for c in passed_codes:
                base = base_map.get(c, {})
                score, hits = _score_one(c, base, scorers)
                scored.append(
                    Candidate(
                        code=c,
                        name=base.get("name", ""),
                        industry=base.get("industry", ""),
                        score=score,
                        factor_hits=hits,
                        base_data={
                            "valuation": base.get("valuation"),
                            "fundamentals": base.get("fundamentals"),
                            "factors": base.get("factors"),
                        },
                    )
                )

            scored.sort(key=lambda c: c.score, reverse=True)
            final = scored[:top_n]
            return ScreenerResult(
                universe=universe,
                universe_size=uni_size,
                pre_filter_count=pre_filter_count,
                final_count=len(final),
                candidates=final,
                trade_date=trade_date,
            )
    finally:
        engine.dispose()
