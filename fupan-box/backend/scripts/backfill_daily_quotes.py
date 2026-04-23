"""backfill_daily_quotes.py — Phase 1.1 / Phase 1.2

按 trade_date 调 pro.daily（一次取全市场 OHLCV），合并 pro.daily_basic 的 turnover_rate，
upsert 到 daily_quotes 表。

用法：
  python scripts/backfill_daily_quotes.py --start 20000101 --resume
  python scripts/backfill_daily_quotes.py --start 20240101 --reverse
  python scripts/backfill_daily_quotes.py --start 20100101 --end 20191231

幂等：(stock_code, trade_date) 唯一约束，重跑只更新。
断点：--resume 时跳过 daily_quotes 已存在的 trade_date。
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.stock import DailyQuote
from scripts._backfill_common import (
    RateLimiter,
    db_engine,
    existing_dates,
    iter_trade_dates,
    log_step,
    parse_args,
    setup_logging,
    tushare_pro,
)


logger = setup_logging("backfill_daily_quotes")


def _norm_code(ts_code) -> str:
    if ts_code is None:
        return ""
    s = str(ts_code).strip()
    return s.split(".")[0] if s else ""


def _safe_float(v, default=0.0):
    try:
        if pd.isna(v):
            return default
    except (TypeError, ValueError):
        pass
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _safe_int(v, default=0):
    f = _safe_float(v, None)
    try:
        return int(f) if f is not None else default
    except Exception:
        return default


def fetch_one_day(pro, trade_date: date) -> list[dict]:
    d = trade_date.strftime("%Y%m%d")
    try:
        df = pro.daily(trade_date=d)
    except Exception as e:
        logger.warning(f"daily {d} failed: {e}")
        return []
    if df is None or df.empty:
        return []

    try:
        db = pro.daily_basic(trade_date=d, fields="ts_code,turnover_rate")
    except Exception as e:
        logger.warning(f"daily_basic {d}: {e}")
        db = None

    tr_map: dict[str, float | None] = {}
    if db is not None and not db.empty:
        for _, r in db.iterrows():
            tr_map[r.get("ts_code")] = _safe_float(r.get("turnover_rate"), None)

    rows: list[dict] = []
    for _, r in df.iterrows():
        code = _norm_code(r.get("ts_code"))
        if not code:
            continue
        try:
            pre = _safe_float(r.get("pre_close"), 0.0)
            hi = _safe_float(r.get("high"), 0.0)
            lo = _safe_float(r.get("low"), 0.0)
            amp = ((hi - lo) / pre * 100) if pre > 0 else None
            vol_hand = _safe_int(r.get("vol"), 0)
            amount_kyuan = _safe_float(r.get("amount"), 0.0)
            close = _safe_float(r.get("close"), 0.0)
            change_pct = _safe_float(r.get("pct_chg"), 0.0)
            rows.append(
                {
                    "stock_code": code,
                    "trade_date": trade_date,
                    "open": _safe_float(r.get("open"), 0.0),
                    "high": hi,
                    "low": lo,
                    "close": close,
                    "pre_close": pre,
                    "change_pct": change_pct,
                    "volume": vol_hand * 100,
                    "amount": amount_kyuan * 1000,
                    "turnover_rate": tr_map.get(r.get("ts_code")),
                    "amplitude": amp,
                    "is_limit_up": False,
                    "is_limit_down": False,
                }
            )
        except Exception:
            continue
    return rows


def upsert(rows: list[dict]) -> int:
    if not rows:
        return 0
    eng = db_engine()
    with eng.begin() as conn:
        for chunk_start in range(0, len(rows), 1000):
            chunk = rows[chunk_start : chunk_start + 1000]
            stmt = pg_insert(DailyQuote.__table__).values(chunk)
            update_cols = {
                c: stmt.excluded[c]
                for c in (
                    "open",
                    "high",
                    "low",
                    "close",
                    "pre_close",
                    "change_pct",
                    "volume",
                    "amount",
                    "turnover_rate",
                    "amplitude",
                )
            }
            stmt = stmt.on_conflict_do_update(
                constraint="uq_daily_quotes", set_=update_cols
            )
            conn.execute(stmt)
    return len(rows)


def main() -> int:
    args = parse_args(default_start="20000101")
    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))

    logger.info(f"backfill_daily_quotes {start} → {end} resume={args.resume} reverse={args.reverse}")

    skip_set: set[date] = set()
    if args.resume:
        skip_set = existing_dates("daily_quotes")
        logger.info(f"resume: skipping {len(skip_set)} dates already in daily_quotes")

    pro = tushare_pro()
    limiter = RateLimiter(args.rate)

    n_days = 0
    total_rows = 0
    for td in iter_trade_dates(start, end, descending=args.reverse):
        if td in skip_set:
            continue
        if args.limit_days and n_days >= args.limit_days:
            break
        limiter.wait()
        rows = fetch_one_day(pro, td)
        if not rows:
            logger.warning(f"{td}: no data")
            log_step(td, "backfill_daily_quotes", "empty", 0)
            n_days += 1
            continue
        # daily_basic 用了第二次调用，再睡一拍避免节流
        limiter.wait()
        try:
            inserted = upsert(rows)
        except Exception as e:
            logger.error(f"{td}: upsert failed: {e}")
            log_step(td, "backfill_daily_quotes", "failed", 0, str(e))
            continue
        total_rows += inserted
        n_days += 1
        log_step(td, "backfill_daily_quotes", "success", inserted)
        if n_days % 20 == 0:
            logger.info(f"progress: {n_days} days, {total_rows} rows so far ({td})")
        else:
            logger.info(f"{td}: +{inserted}")

    logger.info(f"DONE. days={n_days}, rows={total_rows}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
