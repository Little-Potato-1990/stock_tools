"""sync_stock_master.py — 同步全 A 股票主数据（plan §10.1 Phase 0）。

数据源：Tushare Pro
- pro.stock_basic(list_status=L|D|P)  上市/退市/暂停
- pro.namechange                       含 ST/*ST 历史改名（用最新一条判定当前 ST 状态）

目标：
- stocks 表落 status / delist_date / list_date / board / is_st / industry / market
- status 取值：listed_active / st / star_st / suspended / delisted

幂等：按 code upsert，重跑只更新变化字段。
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# 让脚本能直接 `python backend/scripts/sync_stock_master.py` 跑
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd
import tushare as ts
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import get_settings
from app.models.stock import Stock

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("sync_stock_master")


def _board_from_code_market(code: str, market: str) -> str:
    code = str(code).zfill(6)
    if market == "BJ":
        return "北交所"
    if code.startswith("688") or code.startswith("689"):
        return "科创板"
    if code.startswith("30"):
        return "创业板"
    return "主板"


def _market_from_ts(ts_code: str) -> str:
    if ts_code.endswith(".SH"):
        return "SH"
    if ts_code.endswith(".SZ"):
        return "SZ"
    if ts_code.endswith(".BJ"):
        return "BJ"
    return "SH"


def fetch_stock_basic(pro, list_status: str) -> pd.DataFrame:
    fields = "ts_code,symbol,name,industry,market,list_date,delist_date,list_status"
    try:
        df = pro.stock_basic(list_status=list_status, fields=fields)
    except Exception as e:
        logger.warning(f"stock_basic({list_status}) failed: {e}")
        return pd.DataFrame()
    return df if df is not None else pd.DataFrame()


def fetch_latest_st_codes(pro) -> set[str]:
    """通过 namechange 判定当前 ST 状态。

    namechange.change_reason 含 'ST' / '*ST' 字样，且 end_date 为空或 > 今日，
    认为当前正处于 ST 状态。
    """
    try:
        df = pro.namechange(
            fields="ts_code,name,start_date,end_date,change_reason",
        )
    except Exception as e:
        logger.warning(f"namechange failed: {e}")
        return set()
    if df is None or df.empty:
        return set()
    df = df.dropna(subset=["ts_code", "name"])
    df["start_date"] = pd.to_datetime(df["start_date"], errors="coerce")
    df["end_date"] = pd.to_datetime(df["end_date"], errors="coerce")
    df = df.sort_values("start_date")
    latest = df.groupby("ts_code").tail(1)
    today = pd.Timestamp(datetime.now().date())
    st_codes: set[str] = set()
    for _, r in latest.iterrows():
        name = str(r["name"] or "")
        end = r["end_date"]
        if "ST" not in name.upper():
            continue
        if pd.isna(end) or end >= today:
            ts_code = str(r["ts_code"])
            st_codes.add(ts_code.split(".")[0])
    return st_codes


def upsert_stocks(rows: list[dict]) -> int:
    if not rows:
        return 0
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    n = 0
    with engine.begin() as conn:
        for chunk_start in range(0, len(rows), 500):
            chunk = rows[chunk_start : chunk_start + 500]
            stmt = pg_insert(Stock.__table__).values(chunk)
            update_cols = {
                c: stmt.excluded[c]
                for c in (
                    "name",
                    "market",
                    "list_date",
                    "delist_date",
                    "is_st",
                    "status",
                    "board",
                    "industry",
                    "updated_at",
                )
            }
            stmt = stmt.on_conflict_do_update(
                index_elements=["code"], set_=update_cols
            )
            conn.execute(stmt)
            n += len(chunk)
    engine.dispose()
    return n


def main() -> int:
    settings = get_settings()
    token = (
        os.getenv("TUSHARE_TOKEN")
        or settings.tushare_token
        or ""
    )
    if not token:
        logger.error("TUSHARE_TOKEN missing — set env or .env")
        return 1
    ts.set_token(token)
    pro = ts.pro_api()

    logger.info("fetching stock_basic L/D/P + namechange ...")
    df_l = fetch_stock_basic(pro, "L")
    df_d = fetch_stock_basic(pro, "D")
    df_p = fetch_stock_basic(pro, "P")
    logger.info(f"L={len(df_l)} D={len(df_d)} P={len(df_p)}")

    st_codes = fetch_latest_st_codes(pro)
    logger.info(f"ST codes count: {len(st_codes)}")

    rows: list[dict] = []
    now = datetime.now()
    for df, default_status in (
        (df_l, "listed_active"),
        (df_d, "delisted"),
        (df_p, "suspended"),
    ):
        if df.empty:
            continue
        for _, r in df.iterrows():
            ts_code = str(r.get("ts_code") or "")
            symbol = str(r.get("symbol") or "").zfill(6)
            if not symbol:
                continue
            market = _market_from_ts(ts_code)
            board = _board_from_code_market(symbol, market)
            name = str(r.get("name") or "")[:20]
            list_date = pd.to_datetime(r.get("list_date"), errors="coerce")
            delist_date = pd.to_datetime(r.get("delist_date"), errors="coerce")
            is_st = symbol in st_codes
            status = default_status
            if status == "listed_active" and is_st:
                # 区分 *ST(退市风险警示) 和 ST(其他风险警示)
                status = "star_st" if name.upper().startswith("*ST") else "st"
            rows.append(
                {
                    "code": symbol,
                    "name": name,
                    "market": market,
                    "list_date": list_date.date() if not pd.isna(list_date) else None,
                    "delist_date": (
                        delist_date.date() if not pd.isna(delist_date) else None
                    ),
                    "is_st": is_st,
                    "status": status,
                    "board": board,
                    "industry": str(r.get("industry") or "")[:50] or None,
                    "created_at": now,
                    "updated_at": now,
                }
            )

    logger.info(f"upserting {len(rows)} stocks ...")
    n = upsert_stocks(rows)
    logger.info(f"upsert done: {n}")

    # 校验
    engine = create_engine(settings.database_url_sync)
    with engine.connect() as conn:
        stats = conn.execute(
            text(
                "SELECT status, COUNT(*) FROM stocks GROUP BY status ORDER BY status"
            )
        ).all()
        for s, c in stats:
            logger.info(f"  status={s}: {c}")
    engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
