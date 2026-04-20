"""P2 盘中异动扫描 — celery beat 9:30-11:30 + 13:00-15:00 每分钟."""
import logging
from datetime import datetime, time

from app.tasks.celery_app import celery
from app.intraday.anomaly_detector import scan_once

logger = logging.getLogger(__name__)


def _is_trading_now() -> bool:
    now = datetime.now().time()
    return (time(9, 30) <= now <= time(11, 30)) or (time(13, 0) <= now <= time(15, 0))


@celery.task(name="app.tasks.intraday_scan.intraday_scan_task")
def intraday_scan_task():
    if not _is_trading_now():
        return {"skipped": "not_trading_time"}
    try:
        result = scan_once()
        if result.get("saved", 0) > 0:
            logger.info(f"intraday scan: {result}")
        return result
    except Exception as e:
        logger.exception(f"intraday scan failed: {e}")
        return {"error": str(e)}
