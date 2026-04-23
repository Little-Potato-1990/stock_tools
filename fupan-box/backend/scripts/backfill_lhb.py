"""backfill_lhb.py — Phase 1.7

按 trade_date 调 pro.top_list / pro.top_inst，把每日的龙虎榜个股 + 营业部明细聚合
为 DailySnapshot(snapshot_type='lhb')，含 stocks / insts_by_code / hot_money_top 三块。

复用 runner._step_collect 中的聚合逻辑（精简版）。
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from app.models.snapshot import DailySnapshot
from app.pipeline.tushare_adapter import TushareAdapter
from scripts._backfill_common import (
    RateLimiter,
    db_engine,
    iter_trade_dates,
    log_step,
    parse_args,
    setup_logging,
)


logger = setup_logging("backfill_lhb")


def existing_lhb_dates() -> set[date]:
    eng = db_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT DISTINCT trade_date FROM daily_snapshots "
                "WHERE snapshot_type='lhb'"
            )
        ).fetchall()
    return {r[0] for r in rows if r[0]}


def aggregate_lhb(stocks: list[dict], insts: list[dict]) -> dict:
    insts_by_code: dict[str, list[dict]] = {}
    for it in insts:
        insts_by_code.setdefault(it["stock_code"], []).append(it)
    for arr in insts_by_code.values():
        arr.sort(key=lambda x: x.get("net_buy", 0), reverse=True)

    hot_money: dict[str, dict] = {}
    for it in insts:
        if it.get("is_inst"):
            continue
        name = it.get("exalter", "")
        if not name:
            continue
        rec = hot_money.setdefault(
            name,
            {
                "exalter": name,
                "appearance": 0,
                "buy_total": 0.0,
                "sell_total": 0.0,
                "net_buy_total": 0.0,
                "stocks": [],
            },
        )
        rec["appearance"] += 1
        rec["buy_total"] += it.get("buy", 0.0)
        rec["sell_total"] += it.get("sell", 0.0)
        rec["net_buy_total"] += it.get("net_buy", 0.0)
        rec["stocks"].append(
            {
                "stock_code": it["stock_code"],
                "net_buy": it["net_buy"],
                "side": it["side"],
            }
        )
    hot_money_list = sorted(
        hot_money.values(), key=lambda x: x["net_buy_total"], reverse=True
    )
    return {
        "stock_count": len(stocks),
        "inst_count": len(insts),
        "stocks": stocks,
        "insts_by_code": insts_by_code,
        "hot_money_top": hot_money_list[:50],
    }


def main() -> int:
    args = parse_args(default_start="20100101")
    start = date(*map(int, [args.start[:4], args.start[4:6], args.start[6:8]]))
    end = date(*map(int, [args.end[:4], args.end[4:6], args.end[6:8]]))

    logger.info(
        f"backfill_lhb {start} → {end} resume={args.resume} reverse={args.reverse}"
    )

    skip_set: set[date] = set()
    if args.resume:
        skip_set = existing_lhb_dates()
        logger.info(f"resume: skipping {len(skip_set)} dates already in lhb snapshot")

    adapter = TushareAdapter()
    limiter = RateLimiter(args.rate)
    eng = db_engine()

    n_days = 0
    total_stocks = 0
    with Session(eng) as s:
        for td in iter_trade_dates(start, end, descending=args.reverse):
            if td in skip_set:
                continue
            if args.limit_days and n_days >= args.limit_days:
                break
            limiter.wait()
            try:
                stocks = adapter.fetch_lhb_list(td)
            except Exception as e:
                logger.error(f"{td}: top_list failed: {e}")
                stocks = []
            limiter.wait()
            try:
                insts = adapter.fetch_lhb_inst(td)
            except Exception as e:
                logger.error(f"{td}: top_inst failed: {e}")
                insts = []

            if not stocks:
                logger.warning(f"{td}: no LHB")
                log_step(td, "backfill_lhb", "empty", 0)
                n_days += 1
                continue

            payload = aggregate_lhb(stocks, insts)
            try:
                s.execute(
                    delete(DailySnapshot).where(
                        DailySnapshot.trade_date == td,
                        DailySnapshot.snapshot_type == "lhb",
                    )
                )
                s.add(
                    DailySnapshot(
                        trade_date=td, snapshot_type="lhb", data=payload
                    )
                )
                s.commit()
            except Exception as e:
                s.rollback()
                logger.error(f"{td}: persist failed: {e}")
                log_step(td, "backfill_lhb", "failed", 0, str(e))
                continue

            total_stocks += len(stocks)
            n_days += 1
            log_step(td, "backfill_lhb", "success", len(stocks))
            if n_days % 50 == 0:
                logger.info(
                    f"progress: {n_days} days, {total_stocks} stocks ({td})"
                )
            else:
                logger.info(f"{td}: stocks={len(stocks)} insts={len(insts)}")

    logger.info(f"DONE. days={n_days}, stocks={total_stocks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
