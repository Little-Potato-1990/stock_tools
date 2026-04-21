"""Prewarm Universe Resolver — 统一计算每日预热"白名单股票池".

思路:
    - 全市场 5300 只 × N 种 brief 全预热, LLM 成本爆炸; 但只用涨停/top30
      预热又会让 95% 的用户点击落到 lazy LLM 通路.
    - 折中策略: 抽取一个"高价值 universe", 命中绝大部分用户实际点击场景:
        1) 全部用户自选股 (UserWatchlist)
        2) 全部用户持仓股 (UserTrade 近 30 日有交易, 视为"关注")
        3) 当日涨停 (LimitUpRecord)
        4) 当日盘中异动 severity ≥ 3 (IntradayAnomaly)
        5) 当日成交额 top500 (DailyQuote.amount)
        6) 总市值 top500 (StockValuationDaily.total_mv) — 大白马兜底
    - 去重后 800-1500 只, 既满足预热成本可控, 又覆盖 95% 实际点击.

提供:
    resolve_prewarm_universe(td)        -> set[str]   # 全局预热池
    resolve_user_universe(user_id, td)  -> list[str]  # per-user 预热池
"""
from __future__ import annotations

import logging
from datetime import date as date_type, timedelta
from typing import Iterable

from sqlalchemy import create_engine, select, desc, func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.anomaly import IntradayAnomaly
from app.models.market import LimitUpRecord
from app.models.stock import DailyQuote
from app.models.user import UserTrade, UserWatchlist
from app.models.valuation import StockValuationDaily

logger = logging.getLogger(__name__)


# === 池规模上限, 防异常数据导致 universe 爆炸 ===
TOP_AMOUNT_N = 500
TOP_MV_N = 500
RECENT_TRADE_DAYS = 30
ANOMALY_MIN_SEVERITY = 3
UNIVERSE_HARD_CAP = 2000


def _normalize(code: str | None) -> str | None:
    if not code:
        return None
    c = str(code).strip()
    if not c.isdigit():
        return None
    return c.zfill(6)


def _collect_watchlist(s: Session) -> set[str]:
    rows = s.execute(select(UserWatchlist.stock_code)).scalars().all()
    return {n for n in (_normalize(c) for c in rows) if n}


def _collect_holdings(s: Session, today: date_type) -> set[str]:
    start = today - timedelta(days=RECENT_TRADE_DAYS)
    rows = s.execute(
        select(UserTrade.code).where(UserTrade.trade_date.between(start, today))
    ).scalars().all()
    return {n for n in (_normalize(c) for c in rows) if n}


def _collect_limit_up(s: Session, td: date_type) -> set[str]:
    rows = s.execute(
        select(LimitUpRecord.stock_code).where(LimitUpRecord.trade_date == td)
    ).scalars().all()
    return {n for n in (_normalize(c) for c in rows) if n}


def _collect_anomalies(s: Session, td: date_type) -> set[str]:
    rows = s.execute(
        select(IntradayAnomaly.code).where(
            IntradayAnomaly.trade_date == td,
            IntradayAnomaly.severity >= ANOMALY_MIN_SEVERITY,
            IntradayAnomaly.code.isnot(None),
        )
    ).scalars().all()
    return {n for n in (_normalize(c) for c in rows) if n}


def _collect_top_amount(s: Session, td: date_type, n: int = TOP_AMOUNT_N) -> set[str]:
    rows = s.execute(
        select(DailyQuote.stock_code)
        .where(DailyQuote.trade_date == td, DailyQuote.amount.isnot(None))
        .order_by(desc(DailyQuote.amount))
        .limit(n)
    ).scalars().all()
    return {n_ for n_ in (_normalize(c) for c in rows) if n_}


def _collect_top_mv(s: Session, td: date_type, n: int = TOP_MV_N) -> set[str]:
    rows = s.execute(
        select(StockValuationDaily.stock_code)
        .where(
            StockValuationDaily.trade_date == td,
            StockValuationDaily.total_mv.isnot(None),
        )
        .order_by(desc(StockValuationDaily.total_mv))
        .limit(n)
    ).scalars().all()
    out = {n_ for n_ in (_normalize(c) for c in rows) if n_}
    if out:
        return out

    # valuation 表当日尚未回填时, 退化到最近一日
    latest = s.execute(
        select(func.max(StockValuationDaily.trade_date)).where(
            StockValuationDaily.total_mv.isnot(None)
        )
    ).scalar_one_or_none()
    if not latest:
        return set()
    rows = s.execute(
        select(StockValuationDaily.stock_code)
        .where(
            StockValuationDaily.trade_date == latest,
            StockValuationDaily.total_mv.isnot(None),
        )
        .order_by(desc(StockValuationDaily.total_mv))
        .limit(n)
    ).scalars().all()
    return {n_ for n_ in (_normalize(c) for c in rows) if n_}


def resolve_prewarm_universe(
    td: date_type,
    *,
    include_watchlist: bool = True,
    include_holdings: bool = True,
    include_limit_up: bool = True,
    include_anomalies: bool = True,
    include_top_amount: bool = True,
    include_top_mv: bool = True,
    hard_cap: int = UNIVERSE_HARD_CAP,
) -> set[str]:
    """计算当日预热白名单池. 同步函数, 给 celery worker 用."""
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    universe: set[str] = set()
    breakdown: dict[str, int] = {}
    try:
        with Session(eng) as s:
            if include_watchlist:
                w = _collect_watchlist(s)
                breakdown["watchlist"] = len(w)
                universe |= w
            if include_holdings:
                h = _collect_holdings(s, td)
                breakdown["holdings"] = len(h)
                universe |= h
            if include_limit_up:
                lu = _collect_limit_up(s, td)
                breakdown["limit_up"] = len(lu)
                universe |= lu
            if include_anomalies:
                an = _collect_anomalies(s, td)
                breakdown["anomalies"] = len(an)
                universe |= an
            if include_top_amount:
                ta = _collect_top_amount(s, td)
                breakdown["top_amount"] = len(ta)
                universe |= ta
            if include_top_mv:
                tm = _collect_top_mv(s, td)
                breakdown["top_mv"] = len(tm)
                universe |= tm
    finally:
        eng.dispose()

    if hard_cap and len(universe) > hard_cap:
        logger.warning(
            "universe size %d exceeds hard_cap %d, truncating",
            len(universe), hard_cap,
        )
        universe = set(sorted(universe)[:hard_cap])

    logger.info(
        "resolve_prewarm_universe td=%s size=%d breakdown=%s",
        td, len(universe), breakdown,
    )
    return universe


def resolve_user_universe(user_id: int, td: date_type | None = None) -> list[str]:
    """单用户预热池: 自选 + 近 30 日交易股, 去重排序."""
    settings = get_settings()
    eng = create_engine(settings.database_url_sync, pool_pre_ping=True)
    out: set[str] = set()
    try:
        with Session(eng) as s:
            wl = s.execute(
                select(UserWatchlist.stock_code).where(UserWatchlist.user_id == user_id)
            ).scalars().all()
            out |= {n for n in (_normalize(c) for c in wl) if n}
            base = td or date_type.today()
            start = base - timedelta(days=RECENT_TRADE_DAYS)
            tr = s.execute(
                select(UserTrade.code).where(
                    UserTrade.user_id == user_id,
                    UserTrade.trade_date.between(start, base),
                )
            ).scalars().all()
            out |= {n for n in (_normalize(c) for c in tr) if n}
    finally:
        eng.dispose()
    return sorted(out)


def merge_universe(*sets: Iterable[str]) -> list[str]:
    """合并多个 universe 来源, 排序去重."""
    out: set[str] = set()
    for it in sets:
        out |= {n for n in (_normalize(c) for c in (it or [])) if n}
    return sorted(out)
