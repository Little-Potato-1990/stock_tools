"""季报数据管线——前十大股东 + 前十大流通股东.

每季度公告期密集出现, 由 celery beat 触发: 4/30, 8/30, 10/30 + 每月 1 号回扫.
"""
import logging
from datetime import date, datetime
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import Session
from app.config import get_settings
from app.database import Base
from app.models.snapshot import DataUpdateLog
from app.models.stock import Stock
from app.models.holder import HolderSnapshotQuarterly
from app.pipeline.akshare_adapter import AKShareAdapter
from app.services.holder_matcher import HolderIdentityMatcher

logger = logging.getLogger(__name__)
settings = get_settings()


def _adapter():
    if settings.data_source == "tushare":
        from app.pipeline.tushare_adapter import TushareAdapter
        return TushareAdapter()
    return AKShareAdapter()


def _latest_report_date(today: date | None = None) -> date:
    """根据当前日期推算最新已披露季报截止日."""
    today = today or date.today()
    y, m = today.year, today.month
    if m >= 11:
        return date(y, 9, 30)
    if m >= 9:
        return date(y, 6, 30)
    if m >= 5:
        return date(y, 3, 31)
    if m >= 4:
        return date(y - 1, 12, 31)
    return date(y - 1, 9, 30)


def run_quarterly_pipeline(
    report_date: date | None = None,
    stock_codes: list[str] | None = None,
    limit: int | None = None,
):
    """跑季报股东快照采集.

    Args:
        report_date: 不传则取最新已披露季度.
        stock_codes: 不传则跑全市场 (按 stock 表去重).
        limit: 抽样跑 N 只(开发用).
    """
    engine = create_engine(settings.database_url_sync)
    Base.metadata.create_all(engine)

    rd = report_date or _latest_report_date()
    adapter = _adapter()

    if not hasattr(adapter, "fetch_holder_top10"):
        logger.warning(f"{type(adapter).__name__} has no fetch_holder_top10, skipping quarterly")
        return

    with Session(engine) as session:
        if stock_codes is None:
            q = session.query(Stock.code).distinct()
            if limit:
                q = q.limit(limit)
            stock_codes = [c for (c,) in q.all()]
            # Fallback: stocks 表为空时, 先用 adapter.fetch_stock_list() 拉一次填库
            if not stock_codes and hasattr(adapter, "fetch_stock_list"):
                logger.warning("stocks table empty, bootstrapping via adapter.fetch_stock_list()")
                items = adapter.fetch_stock_list()
                for it in items:
                    code = str(it.get("code", "")).zfill(6)
                    if not code:
                        continue
                    if code.startswith(("60", "68", "9")):
                        market = "SH"
                    elif code.startswith(("4", "8")):
                        market = "BJ"
                    else:
                        market = "SZ"
                    session.merge(Stock(code=code, name=it.get("name", ""), market=market))
                session.commit()
                q = session.query(Stock.code).distinct()
                if limit:
                    q = q.limit(limit)
                stock_codes = [c for (c,) in q.all()]

        log = DataUpdateLog(
            trade_date=rd, step="quarterly_holder", status="running",
        )
        session.add(log)
        session.commit()

        matcher = HolderIdentityMatcher(session)
        matcher.reload()

        # 一次性加载 code -> name 映射, 避免 N+1
        name_map: dict[str, str] = {
            c: n for c, n in session.query(Stock.code, Stock.name).all()
        }

        total = 0
        failed = 0
        for code in stock_codes:
            try:
                rows = []
                rows.extend(adapter.fetch_holder_top10(code, rd))
                rows.extend(adapter.fetch_holder_free_top10(code, rd))
                if not rows:
                    continue
                # 旧记录清理(同 stock + 同 report_date)
                session.execute(
                    delete(HolderSnapshotQuarterly).where(
                        (HolderSnapshotQuarterly.stock_code == code)
                        & (HolderSnapshotQuarterly.report_date == rd)
                    )
                )
                stock_name = name_map.get(code)
                for r in rows:
                    canonical, htype, fund_co = matcher.match(r.get("holder_name", ""))
                    chg_shares = r.get("change_shares")
                    change_type = None
                    if chg_shares is None:
                        change_type = None
                    elif chg_shares > 0:
                        change_type = "add"
                    elif chg_shares < 0:
                        change_type = "cut"
                    else:
                        change_type = "unchanged"
                    session.add(HolderSnapshotQuarterly(
                        report_date=rd,
                        stock_code=code,
                        stock_name=stock_name,
                        holder_name=r["holder_name"],
                        canonical_name=canonical,
                        holder_type=htype,
                        fund_company=fund_co,
                        is_free_float=r.get("is_free_float", False),
                        rank=r.get("rank"),
                        shares=r.get("shares"),
                        shares_pct=r.get("shares_pct"),
                        change_shares=chg_shares,
                        change_pct=r.get("change_pct"),
                        change_type=change_type,
                        weight=5 if canonical else 1,
                    ))
                session.commit()
                total += len(rows)
            except Exception as e:
                session.rollback()
                failed += 1
                logger.warning(f"quarterly holder {code} {rd}: {e}")

        log.status = "success" if failed == 0 else "partial"
        log.records_count = total
        log.error_message = f"failed_codes={failed}" if failed else None
        log.finished_at = datetime.now()
        session.commit()
        logger.info(f"quarterly pipeline done: {len(stock_codes)} stocks, {total} rows, {failed} fail")
