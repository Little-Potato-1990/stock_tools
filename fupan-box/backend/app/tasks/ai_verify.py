"""P3 AI 预测自动 T+3 校验 — celery beat 每日 16:00."""
import logging

from app.tasks.celery_app import celery
from app.ai.prediction_tracker import verify_pending

logger = logging.getLogger(__name__)


@celery.task(name="app.tasks.ai_verify.verify_ai_predictions_task")
def verify_ai_predictions_task(horizon: int = 3):
    try:
        result = verify_pending(horizon=horizon)
        logger.info(f"ai verify (T+{horizon}): {result}")
        return result
    except Exception as e:
        logger.exception(f"ai verify failed: {e}")
        return {"error": str(e)}
