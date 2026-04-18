"""P2 大盘情绪字段迁移 + 历史重算

运行：
    cd backend && .venv/bin/python -m scripts.migrate_sentiment_p2

做两件事：
1. ALTER TABLE 加 6 个新列（幂等）
2. 用现有 LimitUpRecord / DailyQuote 数据,
   重算 main/gem * lu_open_avg / lu_body_avg / lu_change_avg 共 6 个新字段，
   并同步 overview snapshot
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.models.market import LimitUpRecord, MarketSentiment
from app.models.stock import DailyQuote
from app.models.snapshot import DailySnapshot
from app.pipeline.runner import _classify_market

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SETTINGS = get_settings()
ENGINE = create_engine(SETTINGS.database_url_sync)


def alter_table():
    statements = [
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS main_lu_open_avg NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS main_lu_body_avg NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS main_lu_change_avg NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS gem_lu_open_avg NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS gem_lu_body_avg NUMERIC(8,4)",
        "ALTER TABLE market_sentiment ADD COLUMN IF NOT EXISTS gem_lu_change_avg NUMERIC(8,4)",
    ]
    with ENGINE.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
    log.info("ALTER TABLE done (6 columns ensured)")


def recompute_one(session: Session, sent: MarketSentiment) -> dict:
    trade_date = sent.trade_date

    quotes = session.query(DailyQuote).filter(DailyQuote.trade_date == trade_date).all()
    quotes_map = {q.stock_code: q for q in quotes}

    from sqlalchemy import func as sa_func
    prev_date = session.query(sa_func.max(MarketSentiment.trade_date)).filter(
        MarketSentiment.trade_date < trade_date
    ).scalar()

    if not prev_date:
        return {k: None for k in (
            "main_lu_open_avg", "main_lu_body_avg", "main_lu_change_avg",
            "gem_lu_open_avg", "gem_lu_body_avg", "gem_lu_change_avg",
        )}

    prev_lu_codes = [
        r.stock_code for r in
        session.query(LimitUpRecord).filter(LimitUpRecord.trade_date == prev_date).all()
    ]

    def _avg_pct_of(codes: list[str]):
        opens, bodies, changes = [], [], []
        for c in codes:
            q = quotes_map.get(c)
            if not q or not q.pre_close or not q.open or not q.close:
                continue
            pre = float(q.pre_close)
            op = float(q.open)
            cl = float(q.close)
            if pre <= 0 or op <= 0:
                continue
            opens.append((op - pre) / pre)
            bodies.append((cl - op) / op)
            changes.append((cl - pre) / pre)
        mean = lambda xs: round(sum(xs) / len(xs), 4) if xs else None
        return mean(opens), mean(bodies), mean(changes)

    main_codes = [c for c in prev_lu_codes if _classify_market(c) in ("sh_main", "sz_main")]
    gem_codes = [c for c in prev_lu_codes if _classify_market(c) == "gem"]
    m_open, m_body, m_change = _avg_pct_of(main_codes)
    g_open, g_body, g_change = _avg_pct_of(gem_codes)

    return {
        "main_lu_open_avg": m_open,
        "main_lu_body_avg": m_body,
        "main_lu_change_avg": m_change,
        "gem_lu_open_avg": g_open,
        "gem_lu_body_avg": g_body,
        "gem_lu_change_avg": g_change,
    }


def sync_overview_snapshot(session: Session, sent: MarketSentiment):
    snap = session.query(DailySnapshot).filter(
        DailySnapshot.trade_date == sent.trade_date,
        DailySnapshot.snapshot_type == "overview",
    ).first()
    if not snap:
        return
    data = dict(snap.data or {})
    data.update({
        "main_lu_open_avg": float(sent.main_lu_open_avg) if sent.main_lu_open_avg is not None else None,
        "main_lu_body_avg": float(sent.main_lu_body_avg) if sent.main_lu_body_avg is not None else None,
        "main_lu_change_avg": float(sent.main_lu_change_avg) if sent.main_lu_change_avg is not None else None,
        "gem_lu_open_avg": float(sent.gem_lu_open_avg) if sent.gem_lu_open_avg is not None else None,
        "gem_lu_body_avg": float(sent.gem_lu_body_avg) if sent.gem_lu_body_avg is not None else None,
        "gem_lu_change_avg": float(sent.gem_lu_change_avg) if sent.gem_lu_change_avg is not None else None,
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
