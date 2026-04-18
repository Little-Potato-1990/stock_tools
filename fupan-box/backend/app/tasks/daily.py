from datetime import date
from app.tasks.celery_app import celery
from app.pipeline.runner import run_daily_pipeline


@celery.task(name="app.tasks.daily.run_pipeline_task", bind=True, max_retries=3)
def run_pipeline_task(self, trade_date_str: str | None = None):
    try:
        td = date.fromisoformat(trade_date_str) if trade_date_str else date.today()
        run_daily_pipeline(td)
    except Exception as exc:
        self.retry(exc=exc, countdown=60 * (self.request.retries + 1))
