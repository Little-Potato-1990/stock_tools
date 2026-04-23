"""Phase 1 backfill 脚本共享工具。

提供：
- `iter_trade_dates(start, end, descending)` ：按交易日历返回区间内 dates。
- `RateLimiter`：Tushare 5000 积分 ≈ 180 次/分钟，保守 200 次/分钟限速。
- `log_step(...)`：写 data_update_log 表。
- `db_engine()`、`tushare_pro()` ：单例懒加载。
- `latest_done(table, key, default_start)`：续跑时找最大已完成 trade_date。

所有 backfill 脚本约定入参：
  --start YYYYMMDD --end YYYYMMDD --resume --reverse --rate <calls_per_min>

`--resume` 时自动从 `latest_done` 开始；`--reverse` 倒序跑（新→旧，先把热数据补上）。
"""
from __future__ import annotations

import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Iterator

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, text

from app.config import get_settings


def setup_logging(name: str) -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        force=True,
    )
    return logging.getLogger(name)


@lru_cache(maxsize=1)
def db_engine():
    settings = get_settings()
    return create_engine(settings.database_url_sync, pool_pre_ping=True)


@lru_cache(maxsize=1)
def tushare_pro():
    settings = get_settings()
    token = os.getenv("TUSHARE_TOKEN") or settings.tushare_token
    if not token:
        raise RuntimeError("TUSHARE_TOKEN missing")
    import tushare as ts

    ts.set_token(token)
    return ts.pro_api()


class RateLimiter:
    """简单调用限速器；calls_per_min 默认 180。"""

    def __init__(self, calls_per_min: int = 180):
        self.interval = 60.0 / max(calls_per_min, 1)
        self._last = 0.0

    def wait(self):
        now = time.time()
        elapsed = now - self._last
        if elapsed < self.interval:
            time.sleep(self.interval - elapsed)
        self._last = time.time()


@lru_cache(maxsize=4)
def _trade_cal(start_str: str, end_str: str) -> list[date]:
    """返回 [start, end] 区间内的交易日（is_open=1），升序。"""
    pro = tushare_pro()
    df = pro.trade_cal(
        exchange="SSE", start_date=start_str, end_date=end_str, is_open="1"
    )
    if df is None or df.empty:
        return []
    df = df.sort_values("cal_date")
    return [
        datetime.strptime(s, "%Y%m%d").date() for s in df["cal_date"].astype(str)
    ]


def iter_trade_dates(
    start: date, end: date, descending: bool = False
) -> Iterator[date]:
    s = start.strftime("%Y%m%d")
    e = end.strftime("%Y%m%d")
    days = _trade_cal(s, e)
    if descending:
        days = list(reversed(days))
    for d in days:
        yield d


def latest_trade_date_in_table(
    table: str, date_col: str = "trade_date"
) -> date | None:
    eng = db_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(f"SELECT MAX({date_col}) FROM {table}")
        ).fetchone()
    if row and row[0]:
        v = row[0]
        return v if isinstance(v, date) else pd.to_datetime(v).date()
    return None


def existing_dates(table: str, date_col: str = "trade_date") -> set[date]:
    eng = db_engine()
    with eng.connect() as conn:
        rows = conn.execute(
            text(f"SELECT DISTINCT {date_col} FROM {table}")
        ).fetchall()
    return {r[0] for r in rows if r[0]}


def log_step(
    trade_date: date,
    step: str,
    status: str,
    records: int = 0,
    error: str | None = None,
):
    eng = db_engine()
    with eng.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO data_update_log
                  (trade_date, step, status, started_at, finished_at,
                   records_count, error_message)
                VALUES (:td, :st, :ss, :now, :now, :rc, :err)
                """
            ),
            {
                "td": trade_date,
                "st": step,
                "ss": status,
                "now": datetime.now(),
                "rc": records,
                "err": (error or "")[:500] if error else None,
            },
        )


def parse_args(default_start: str = "20000101"):
    """所有 backfill 脚本通用入参。"""
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--start", default=default_start, help="YYYYMMDD")
    p.add_argument(
        "--end",
        default=date.today().strftime("%Y%m%d"),
        help="YYYYMMDD (默认今日)",
    )
    p.add_argument(
        "--resume",
        action="store_true",
        help="跳过已存在的 trade_date（按目标表最大日推进）",
    )
    p.add_argument(
        "--reverse",
        action="store_true",
        help="倒序回补（新→旧）",
    )
    p.add_argument(
        "--rate",
        type=int,
        default=180,
        help="Tushare 调用上限/分钟（默认 180，保守）",
    )
    p.add_argument(
        "--limit-days",
        type=int,
        default=0,
        help="只跑前 N 天（0=不限制，调试用）",
    )
    return p.parse_args()
