"""P1 大盘情绪字段迁移 + 历史重算

运行：
    cd backend && .venv/bin/python -m scripts.migrate_sentiment_p1

做两件事：
1. ALTER TABLE 加 5 个新列（幂等）
2. 用现有 LimitUpRecord / LimitDownRecord / DailyQuote 数据,
   重算所有历史日期的 5 个新字段 + open_limit_up / open_limit_down，
   并同步 overview 快照
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
from datetime import time as dtime
from sqlalchemy import create_engine, text, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.models.market import LimitUpRecord, LimitDownRecord, MarketSentiment
from app.models.stock import DailyQuote
from app.models.snapshot import DailySnapshot
from app.pipeline.runner import _classify_market

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SETTINGS = get_settings()
ENGINE = create_engine(SETTINGS.database_url_sync)


def alter_table():
    """幂等加列"""
    statements = [
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS sh_up_rate NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS sz_up_rate NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS gem_up_rate NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS yesterday_panic_up_rate NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS yesterday_weak_up_rate NUMERIC(8,4)",
    ]
    with ENGINE.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
    log.info("ALTER TABLE done (5 columns ensured)")


def recompute_one(session: Session, sent: MarketSentiment) -> dict:
    """对单日 sent 重算 5 个新字段 + 2 个 open_limit 字段，返回更新字典"""
    trade_date = sent.trade_date

    quotes = session.query(DailyQuote).filter(DailyQuote.trade_date == trade_date).all()
    quotes_map = {q.stock_code: q for q in quotes}

    # 三市场分桶上涨率
    sh_up, sh_total = 0, 0
    sz_up, sz_total = 0, 0
    gem_up, gem_total = 0, 0
    for q in quotes:
        market = _classify_market(q.stock_code)
        if market not in ("sh_main", "sz_main", "gem"):
            continue
        if not q.change_pct:
            continue
        is_up = float(q.change_pct) > 0
        if market == "sh_main":
            sh_total += 1
            sh_up += 1 if is_up else 0
        elif market == "sz_main":
            sz_total += 1
            sz_up += 1 if is_up else 0
        elif market == "gem":
            gem_total += 1
            gem_up += 1 if is_up else 0

    sh_up_rate = round(sh_up / sh_total, 4) if sh_total else None
    sz_up_rate = round(sz_up / sz_total, 4) if sz_total else None
    gem_up_rate = round(gem_up / gem_total, 4) if gem_total else None

    # 开盘涨停 / 开盘跌停
    today_lus = session.query(LimitUpRecord).filter(
        LimitUpRecord.trade_date == trade_date
    ).all()
    open_lu_count = sum(
        1 for r in today_lus
        if r.first_limit_time and r.first_limit_time <= dtime(9, 30, 0)
    )
    open_ld_count = sum(
        1 for q in quotes
        if q.is_limit_down and q.open and q.low and float(q.open) == float(q.low)
    )

    # 昨日衍生上涨率
    from sqlalchemy import func as sa_func
    prev_date = session.query(sa_func.max(MarketSentiment.trade_date)).filter(
        MarketSentiment.trade_date < trade_date
    ).scalar()

    yesterday_panic_rate = None
    yesterday_weak_rate = None
    if prev_date:
        def _up_rate_of(codes: list[str]) -> float | None:
            if not codes:
                return None
            ups = sum(
                1 for c in codes
                if c in quotes_map and quotes_map[c].change_pct
                and float(quotes_map[c].change_pct) > 0
            )
            return round(ups / len(codes), 4)

        prev_lus = session.query(LimitUpRecord).filter(
            LimitUpRecord.trade_date == prev_date
        ).all()
        prev_panic_codes = [r.stock_code for r in prev_lus if r.continuous_days >= 4]
        prev_weak_codes = [
            r.stock_code for r in
            session.query(LimitDownRecord).filter(LimitDownRecord.trade_date == prev_date).all()
        ]
        yesterday_panic_rate = _up_rate_of(prev_panic_codes)
        yesterday_weak_rate = _up_rate_of(prev_weak_codes)

    return {
        "sh_up_rate": sh_up_rate,
        "sz_up_rate": sz_up_rate,
        "gem_up_rate": gem_up_rate,
        "yesterday_panic_up_rate": yesterday_panic_rate,
        "yesterday_weak_up_rate": yesterday_weak_rate,
        "open_limit_up": open_lu_count,
        "open_limit_down": open_ld_count,
    }


def sync_overview_snapshot(session: Session, sent: MarketSentiment):
    """同步 overview snapshot 的 data 字段"""
    snap = session.query(DailySnapshot).filter(
        DailySnapshot.trade_date == sent.trade_date,
        DailySnapshot.snapshot_type == "overview",
    ).first()
    if not snap:
        return
    data = dict(snap.data or {})
    data.update({
        "open_limit_up_count": sent.open_limit_up,
        "open_limit_down_count": sent.open_limit_down,
        "sh_up_rate": float(sent.sh_up_rate) if sent.sh_up_rate is not None else None,
        "sz_up_rate": float(sent.sz_up_rate) if sent.sz_up_rate is not None else None,
        "gem_up_rate": float(sent.gem_up_rate) if sent.gem_up_rate is not None else None,
        "yesterday_panic_up_rate": float(sent.yesterday_panic_up_rate) if sent.yesterday_panic_up_rate is not None else None,
        "yesterday_weak_up_rate": float(sent.yesterday_weak_up_rate) if sent.yesterday_weak_up_rate is not None else None,
    })
    snap.data = data


def main():
    Base.metadata.create_all(ENGINE)
    alter_table()

    with Session(ENGINE) as session:
        rows = session.query(MarketSentiment).order_by(MarketSentiment.trade_date).all()
        log.info(f"重算 {len(rows)} 个交易日...")

        for i, sent in enumerate(rows, 1):
            updates = recompute_one(session, sent)
            for k, v in updates.items():
                setattr(sent, k, v)
            sync_overview_snapshot(session, sent)
            if i % 10 == 0:
                session.commit()
                log.info(f"  [{i}/{len(rows)}] {sent.trade_date} ok")
        session.commit()

    log.info("All done.")


if __name__ == "__main__":
    main()
