"""中长视角数据 pipeline runner.

3 个独立 runner:
- run_fundamentals_pipeline  : 财务指标 + 业绩预告 + 业绩快报
- run_valuation_pipeline     : 单日全市场估值快照 (基础字段)
- run_consensus_pipeline     : 周维度卖方一致预期 (按周聚合)
- recompute_valuation_percentiles : 重算 5 年/3 年 PE/PB 分位 (独立, 月度跑)

所有 runner 跑同步 engine, 由 celery task 包装异步.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import mean, median
from typing import Iterable

from sqlalchemy import create_engine, delete, select, func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.models.snapshot import DataUpdateLog
from app.models.stock import Stock, DailyQuote
from app.models.fundamentals import StockFundamentalsQuarterly, StockForecastEvent
from app.models.valuation import StockValuationDaily
from app.models.consensus import AnalystConsensusWeekly
from app.pipeline.tushare_pro_adapter import TusharePioAdapter

logger = logging.getLogger(__name__)
settings = get_settings()

# tushare 限速: 5000 积分约 200 次/分钟. 留余量按 180 次/分钟限速.
_INTERFACE_INTERVAL = 60.0 / 180.0


def _new_engine():
    return create_engine(settings.database_url_sync)


def _all_stock_codes(s: Session, limit: int | None = None) -> list[str]:
    q = select(Stock.code).where(Stock.is_st.is_(False) if hasattr(Stock, "is_st") else True)
    if limit:
        q = q.limit(limit)
    return [c for (c,) in s.execute(q).all() if c]


def _latest_trade_date(s: Session) -> date | None:
    return s.execute(select(func.max(DailyQuote.trade_date))).scalar_one_or_none()


def _latest_friday(today: date | None = None) -> date:
    today = today or date.today()
    offset = (today.weekday() - 4) % 7
    return today - timedelta(days=offset)


# ============================================================
# 1. 财务指标 + 业绩预告 + 业绩快报
# ============================================================

def run_fundamentals_pipeline(
    stock_codes: list[str] | None = None,
    limit: int | None = None,
    history_years: int = 5,
):
    """拉取全市场 (或子集) 的财务指标 + 业绩预告 + 业绩快报.

    Args:
        stock_codes: 不传则全市场.
        limit: 抽样跑 N 只 (开发用).
        history_years: fina_indicator 回溯年数.
    """
    engine = _new_engine()
    Base.metadata.create_all(engine)
    adapter = TusharePioAdapter()

    with Session(engine) as s:
        codes = stock_codes or _all_stock_codes(s, limit=limit)
        log = DataUpdateLog(
            trade_date=date.today(), step="fundamentals", status="running",
        )
        s.add(log)
        s.commit()

        end_period = date.today().strftime("%Y%m%d")
        start_period = (date.today() - timedelta(days=365 * history_years)).strftime("%Y%m%d")

        total_fund = 0
        total_fc = 0
        failed = 0

        # 1.1 fina_indicator (按股拉, 慢)
        for i, code in enumerate(codes, 1):
            try:
                rows = adapter.fetch_fina_indicator(code, start_period=start_period, end_period=end_period)
                if rows:
                    stmt = pg_insert(StockFundamentalsQuarterly).values(rows)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_fund_quarterly",
                        set_={
                            c.name: stmt.excluded[c.name]
                            for c in StockFundamentalsQuarterly.__table__.columns
                            if c.name not in ("id", "created_at", "stock_code", "report_date")
                        },
                    )
                    s.execute(stmt)
                    s.commit()
                    total_fund += len(rows)
                if i % 50 == 0:
                    logger.info(f"fundamentals {i}/{len(codes)}: +{total_fund} rows")
                time.sleep(_INTERFACE_INTERVAL)
            except Exception as e:
                s.rollback()
                failed += 1
                logger.warning(f"fundamentals {code}: {e}")

        # 1.2 forecast / express (按公告日拉, 快)
        for back in range(0, 30):
            ann = date.today() - timedelta(days=back)
            try:
                fc_rows = adapter.fetch_forecast(ann)
                if fc_rows:
                    stmt = pg_insert(StockForecastEvent).values(fc_rows)
                    stmt = stmt.on_conflict_do_nothing(constraint="uq_forecast_event")
                    s.execute(stmt)
                    s.commit()
                    total_fc += len(fc_rows)
                time.sleep(_INTERFACE_INTERVAL)

                ex_rows = adapter.fetch_express(ann)
                if ex_rows:
                    stmt = pg_insert(StockForecastEvent).values(ex_rows)
                    stmt = stmt.on_conflict_do_nothing(constraint="uq_forecast_event")
                    s.execute(stmt)
                    s.commit()
                    total_fc += len(ex_rows)
                time.sleep(_INTERFACE_INTERVAL)
            except Exception as e:
                s.rollback()
                failed += 1
                logger.warning(f"forecast/express {ann}: {e}")

        log.status = "success" if failed == 0 else "partial"
        log.records_count = total_fund + total_fc
        log.error_message = f"failed={failed}" if failed else None
        log.finished_at = datetime.now()
        s.commit()
        logger.info(
            f"fundamentals pipeline done: {len(codes)} stocks, "
            f"+{total_fund} fund rows, +{total_fc} forecast/express rows, {failed} fail"
        )


# ============================================================
# 2. 估值快照 (单日全市场, 基础字段)
# ============================================================

def run_valuation_pipeline(trade_date: date | None = None):
    """单日全市场估值快照. 5 年分位由 recompute_valuation_percentiles 单独跑."""
    engine = _new_engine()
    Base.metadata.create_all(engine)
    adapter = TusharePioAdapter()

    with Session(engine) as s:
        td = trade_date or _latest_trade_date(s) or date.today()

        log = DataUpdateLog(
            trade_date=td, step="valuation_daily", status="running",
        )
        s.add(log)
        s.commit()

        try:
            rows = adapter.fetch_daily_basic_full(td)
            if rows:
                stmt = pg_insert(StockValuationDaily).values(rows)
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_valuation_daily",
                    set_={
                        c.name: stmt.excluded[c.name]
                        for c in StockValuationDaily.__table__.columns
                        if c.name not in (
                            "id", "created_at", "stock_code", "trade_date",
                            "pe_pct_5y", "pb_pct_5y", "pe_pct_3y", "pb_pct_3y",
                        )
                    },
                )
                s.execute(stmt)
                s.commit()
            log.status = "success"
            log.records_count = len(rows)
            log.finished_at = datetime.now()
            s.commit()
            logger.info(f"valuation pipeline done: {td} +{len(rows)} rows")
        except Exception as e:
            s.rollback()
            log.status = "failed"
            log.error_message = str(e)[:500]
            log.finished_at = datetime.now()
            s.commit()
            logger.error(f"valuation pipeline failed {td}: {e}")
            raise


def recompute_valuation_percentiles(trade_date: date | None = None):
    """重算指定交易日全市场的 5 年/3 年 PE/PB 分位.

    使用 PostgreSQL percent_rank() 窗口函数. 月度跑 1 次足够.
    """
    engine = _new_engine()
    with Session(engine) as s:
        td = trade_date or _latest_trade_date(s) or date.today()
        cutoff_5y = td - timedelta(days=365 * 5)
        cutoff_3y = td - timedelta(days=365 * 3)

        for col, cutoff, target in [
            ("pe_ttm", cutoff_5y, "pe_pct_5y"),
            ("pb", cutoff_5y, "pb_pct_5y"),
            ("pe_ttm", cutoff_3y, "pe_pct_3y"),
            ("pb", cutoff_3y, "pb_pct_3y"),
        ]:
            sql = text(f"""
                WITH hist AS (
                    SELECT stock_code, percent_rank() OVER (
                        PARTITION BY stock_code ORDER BY {col}
                    ) AS pct, trade_date, {col} AS v
                    FROM stock_valuation_daily
                    WHERE trade_date BETWEEN :cutoff AND :td
                      AND {col} IS NOT NULL AND {col} > 0
                )
                UPDATE stock_valuation_daily v
                SET {target} = h.pct
                FROM hist h
                WHERE v.stock_code = h.stock_code
                  AND v.trade_date = h.trade_date
                  AND v.trade_date = :td
            """)
            s.execute(sql, {"cutoff": cutoff, "td": td})
            s.commit()
        logger.info(f"recompute valuation percentiles done: {td}")


# ============================================================
# 3. 卖方一致预期 (按周聚合)
# ============================================================

def run_consensus_pipeline(
    stock_codes: list[str] | None = None,
    limit: int | None = None,
    week_end: date | None = None,
    history_weeks: int = 4,
):
    """按周聚合卖方研报 -> AnalystConsensusWeekly.

    Args:
        week_end: 默认本周五.
        history_weeks: 拉取最近 N 周的研报 (用于聚合 + 计算 4 周变化).
    """
    engine = _new_engine()
    Base.metadata.create_all(engine)
    adapter = TusharePioAdapter()

    with Session(engine) as s:
        we = week_end or _latest_friday()
        codes = stock_codes or _all_stock_codes(s, limit=limit)

        log = DataUpdateLog(
            trade_date=we, step="consensus_weekly", status="running",
        )
        s.add(log)
        s.commit()

        # 拉 8 周窗口 (用于算 4 周 vs 4 周前的变化)
        start = we - timedelta(weeks=history_weeks * 2)
        total = 0
        failed = 0

        for i, code in enumerate(codes, 1):
            try:
                rows = adapter.fetch_report_rc(code, start_date=start, end_date=we)
                if not rows:
                    time.sleep(_INTERFACE_INTERVAL)
                    continue

                # 按周分桶
                by_week: dict[date, list[dict]] = defaultdict(list)
                for r in rows:
                    rep_date = r["report_date"]
                    week_friday = rep_date + timedelta(days=(4 - rep_date.weekday()) % 7)
                    if week_friday > we:
                        week_friday -= timedelta(weeks=1)
                    by_week[week_friday].append(r)

                week_aggs: dict[date, dict] = {}
                for wk, items in by_week.items():
                    targets = [r["target_price"] for r in items if r.get("target_price")]
                    eps_fy1 = [r["eps_fy1"] for r in items if r.get("eps_fy1") is not None]
                    eps_fy2 = [r["eps_fy2"] for r in items if r.get("eps_fy2") is not None]
                    eps_fy3 = [r["eps_fy3"] for r in items if r.get("eps_fy3") is not None]

                    rating_counter = defaultdict(int)
                    orgs = set()
                    for r in items:
                        rating = (r.get("rating") or "").lower()
                        if "买" in rating or "buy" in rating or "推荐" in rating:
                            rating_counter["buy"] += 1
                        elif "增持" in rating or "outperform" in rating:
                            rating_counter["outperform"] += 1
                        elif "持有" in rating or "中性" in rating or "hold" in rating:
                            rating_counter["hold"] += 1
                        elif "减持" in rating or "underperform" in rating:
                            rating_counter["underperform"] += 1
                        elif "卖" in rating or "sell" in rating:
                            rating_counter["sell"] += 1
                        if r.get("org_name"):
                            orgs.add(r["org_name"])

                    week_aggs[wk] = {
                        "stock_code": code,
                        "week_end": wk,
                        "target_price_avg": round(mean(targets), 2) if targets else None,
                        "target_price_median": round(median(targets), 2) if targets else None,
                        "target_price_min": round(min(targets), 2) if targets else None,
                        "target_price_max": round(max(targets), 2) if targets else None,
                        "eps_fy1": round(mean(eps_fy1), 4) if eps_fy1 else None,
                        "eps_fy2": round(mean(eps_fy2), 4) if eps_fy2 else None,
                        "eps_fy3": round(mean(eps_fy3), 4) if eps_fy3 else None,
                        "rating_buy": rating_counter["buy"],
                        "rating_outperform": rating_counter["outperform"],
                        "rating_hold": rating_counter["hold"],
                        "rating_underperform": rating_counter["underperform"],
                        "rating_sell": rating_counter["sell"],
                        "report_count": len(items),
                        "institution_count": len(orgs),
                        "target_price_chg_4w_pct": None,
                        "eps_fy1_chg_4w_pct": None,
                    }

                # 4 周变化: 当周 vs 4 周前
                weeks_sorted = sorted(week_aggs.keys())
                for idx, wk in enumerate(weeks_sorted):
                    prev_wk = wk - timedelta(weeks=4)
                    if prev_wk in week_aggs:
                        cur_t = week_aggs[wk].get("target_price_avg")
                        prev_t = week_aggs[prev_wk].get("target_price_avg")
                        if cur_t and prev_t and prev_t > 0:
                            week_aggs[wk]["target_price_chg_4w_pct"] = round(
                                (cur_t - prev_t) / prev_t * 100, 2
                            )
                        cur_e = week_aggs[wk].get("eps_fy1")
                        prev_e = week_aggs[prev_wk].get("eps_fy1")
                        if cur_e and prev_e and prev_e > 0:
                            week_aggs[wk]["eps_fy1_chg_4w_pct"] = round(
                                (cur_e - prev_e) / prev_e * 100, 2
                            )

                # 落库
                values = list(week_aggs.values())
                if values:
                    stmt = pg_insert(AnalystConsensusWeekly).values(values)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_consensus_weekly",
                        set_={
                            c.name: stmt.excluded[c.name]
                            for c in AnalystConsensusWeekly.__table__.columns
                            if c.name not in ("id", "created_at", "stock_code", "week_end")
                        },
                    )
                    s.execute(stmt)
                    s.commit()
                    total += len(values)

                if i % 50 == 0:
                    logger.info(f"consensus {i}/{len(codes)}: +{total} rows")
                time.sleep(_INTERFACE_INTERVAL)
            except Exception as e:
                s.rollback()
                failed += 1
                logger.warning(f"consensus {code}: {e}")

        log.status = "success" if failed == 0 else "partial"
        log.records_count = total
        log.error_message = f"failed={failed}" if failed else None
        log.finished_at = datetime.now()
        s.commit()
        logger.info(
            f"consensus pipeline done: {len(codes)} stocks, +{total} rows, {failed} fail"
        )
