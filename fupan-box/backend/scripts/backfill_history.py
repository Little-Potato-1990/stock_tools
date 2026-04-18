"""回填历史 snapshot (overview + ladder).

背景: pipeline 的 fetch_daily_quotes 用的是当日实时接口, 无法回溯。
本脚本只补涨停池 + 精简版 sentiment + ladder snapshot, 让前端横向滚动
能滑出更多历史日期。残缺字段:
- total_amount / up_count / down_count / open_high_count / open_low_count
  (依赖 daily_quotes, 这里全部置 0)
- yesterday_lu_up_rate (依赖前一日 quotes, 置 None)
- ladder cell 的 amount (置 None, 前端容忍)

可回溯字段:
- limit_up_count / limit_down_count / broken_limit_count / broken_rate /
  max_height / one_word_count
- 各板级的 stocks 列表 + 晋级率

用法: python -m scripts.backfill_history --days 14
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import time as time_mod

import akshare as ak
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import Session


def _with_retry(fn, *args, retries: int = 3, sleep: float = 1.5, **kwargs):
    last = None
    for i in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            last = e
            time_mod.sleep(sleep * (i + 1))
    raise last

from app.config import get_settings
from app.database import Base
from app.models.market import (
    LadderSummary,
    LimitDownRecord,
    LimitUpRecord,
    MarketSentiment,
)
from app.models.snapshot import DailySnapshot
from app.pipeline.akshare_adapter import _parse_time

settings = get_settings()


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def fetch_limit_up_records(d: date) -> list[dict]:
    date_str = d.strftime("%Y%m%d")
    try:
        df = _with_retry(ak.stock_zt_pool_em, date=date_str)
    except Exception as e:
        print(f"  [skip lu] {d}: {type(e).__name__}")
        return []
    out = []
    for _, row in df.iterrows():
        code = str(row.get("代码", ""))
        if not code:
            continue
        out.append({
            "stock_code": code,
            "stock_name": str(row.get("名称", "")),
            "trade_date": d,
            "continuous_days": int(row.get("连板数", 1) or 1),
            "first_limit_time": _parse_time(row.get("首次封板时间")),
            "last_limit_time": _parse_time(row.get("最后封板时间")),
            "open_count": int(row.get("炸板次数", 0) or 0),
            "limit_order_amount": float(row.get("封板资金", 0) or 0)
            if row.get("封板资金") else None,
            "limit_reason": str(row.get("涨停统计", "")) if row.get("涨停统计") else None,
            "industry": str(row.get("所属行业", "")) if row.get("所属行业") else None,
        })
    return out


def fetch_limit_down_codes(d: date) -> list[str]:
    date_str = d.strftime("%Y%m%d")
    try:
        df = _with_retry(ak.stock_zt_pool_dtgc_em, date=date_str)
        return [str(row["代码"]) for _, row in df.iterrows() if row.get("代码")]
    except Exception as e:
        print(f"  [skip ld] {d}: {type(e).__name__}")
        return []


def is_one_word_lu(rec: dict) -> bool:
    """一字板 = 首次封板时间为 09:25 或 09:30 且无炸板"""
    ft = rec.get("first_limit_time")
    if not ft:
        return False
    return ft.hour == 9 and ft.minute <= 30 and (rec.get("open_count") or 0) == 0


def is_t_board_lu(rec: dict) -> bool:
    """T 字板 = 首次封板时间近开盘且当天有炸板恢复封板"""
    ft = rec.get("first_limit_time")
    if not ft:
        return False
    return ft.hour == 9 and ft.minute <= 30 and (rec.get("open_count") or 0) > 0


def write_day(session: Session, d: date) -> bool:
    print(f"[{d}]", end=" ", flush=True)
    lus = fetch_limit_up_records(d)
    lds = fetch_limit_down_codes(d)
    if not lus and not lds:
        print("no data, skip")
        return False

    session.execute(delete(LimitUpRecord).where(LimitUpRecord.trade_date == d))
    for r in lus:
        session.add(LimitUpRecord(
            stock_code=r["stock_code"],
            stock_name=r["stock_name"],
            trade_date=d,
            continuous_days=r["continuous_days"],
            first_limit_time=r["first_limit_time"],
            last_limit_time=r["last_limit_time"],
            open_count=r["open_count"],
            limit_order_amount=r["limit_order_amount"],
            limit_reason=r["limit_reason"],
            is_one_word=is_one_word_lu(r),
            is_t_board=is_t_board_lu(r),
            industry=r.get("industry"),
        ))

    session.execute(delete(LimitDownRecord).where(LimitDownRecord.trade_date == d))
    for code in lds:
        session.add(LimitDownRecord(stock_code=code, trade_date=d))

    session.commit()

    broken = sum(1 for r in lus if (r.get("open_count") or 0) > 0)
    max_height = max((r["continuous_days"] for r in lus), default=0)
    one_word = sum(1 for r in lus if is_one_word_lu(r))

    session.execute(delete(MarketSentiment).where(MarketSentiment.trade_date == d))
    session.add(MarketSentiment(
        trade_date=d,
        total_amount=0,
        up_count=0,
        down_count=0,
        limit_up_count=len(lus),
        limit_down_count=len(lds),
        broken_limit_count=broken,
        broken_rate=round(broken / len(lus), 4) if lus else 0,
        max_height=max_height,
        open_limit_up=0,
        open_limit_down=0,
        open_high_count=0,
        open_low_count=0,
        up_rate=0,
        yesterday_lu_up_rate=None,
        one_word_count=one_word,
    ))

    level_counts = Counter()
    for r in lus:
        level_counts[min(r["continuous_days"], 7)] += 1
    session.execute(delete(LadderSummary).where(LadderSummary.trade_date == d))
    for level in range(1, 8):
        session.add(LadderSummary(
            trade_date=d,
            board_level=level,
            stock_count=level_counts.get(level, 0),
            promotion_count=0,
            promotion_rate=0,
        ))
    session.commit()

    session.execute(delete(DailySnapshot).where(
        DailySnapshot.trade_date == d,
        DailySnapshot.snapshot_type.in_(["overview", "ladder"]),
    ))
    session.add(DailySnapshot(
        trade_date=d,
        snapshot_type="overview",
        data={
            "total_amount": 0,
            "limit_up_count": len(lus),
            "limit_down_count": len(lds),
            "broken_limit_count": broken,
            "broken_rate": round(broken / len(lus), 4) if lus else 0,
            "max_height": max_height,
            "up_count": 0,
            "down_count": 0,
            "up_rate": 0,
            "open_high_count": 0,
            "open_low_count": 0,
            "yesterday_lu_up_rate": None,
            "one_word_count": one_word,
        },
    ))

    ladder_levels_data = []
    for level in range(7, 0, -1):
        stocks_at_level = [
            {
                "stock_code": r["stock_code"],
                "stock_name": r["stock_name"],
                "first_limit_time": str(r["first_limit_time"]) if r["first_limit_time"] else None,
                "open_count": r["open_count"],
                "limit_reason": r["limit_reason"],
                "industry": r["industry"],
                "theme_names": None,
                "limit_order_amount": r["limit_order_amount"],
                "amount": None,
                "is_one_word": is_one_word_lu(r),
            }
            for r in lus if min(r["continuous_days"], 7) == level
        ]
        ladder_levels_data.append({
            "board_level": level,
            "stock_count": level_counts.get(level, 0),
            "promotion_count": 0,
            "promotion_rate": 0,
            "stocks": stocks_at_level,
        })

    session.add(DailySnapshot(
        trade_date=d,
        snapshot_type="ladder",
        data={"levels": ladder_levels_data},
    ))
    session.commit()
    print(f"lu={len(lus)} ld={len(lds)} max={max_height} ok")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=14, help="回溯多少个工作日")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的日期")
    args = parser.parse_args()

    engine = create_engine(settings.database_url_sync)
    Base.metadata.create_all(engine)

    today = date.today()
    targets: list[date] = []
    cursor = today
    while len(targets) < args.days:
        cursor -= timedelta(days=1)
        if not is_weekend(cursor):
            targets.append(cursor)
    targets.sort()

    with Session(engine) as session:
        existing = {
            d for (d,) in session.execute(
                "SELECT DISTINCT trade_date FROM daily_snapshots WHERE snapshot_type='overview'"
            ).fetchall() if d
        } if False else set()
        from sqlalchemy import select
        rows = session.execute(
            select(DailySnapshot.trade_date).where(DailySnapshot.snapshot_type == "overview")
        ).scalars().all()
        existing = set(rows)

        print(f"Targets: {targets[0]} → {targets[-1]} ({len(targets)} days)")
        print(f"Already in db: {sorted(existing)[-5:]}")
        skipped = 0
        for d in targets:
            if d in existing and not args.force:
                skipped += 1
                continue
            write_day(session, d)
        print(f"Done. Skipped (already exists): {skipped}")


if __name__ == "__main__":
    main()
