"""季报数据任务——通常每季度公告期密集运行."""
from datetime import date
from app.tasks.celery_app import celery
from app.pipeline.quarterly_runner import run_quarterly_pipeline


@celery.task(
    name="app.tasks.quarterly.run_quarterly_holder_task",
    bind=True, max_retries=2,
)
def run_quarterly_holder_task(
    self,
    report_date_str: str | None = None,
    limit: int | None = None,
):
    """跑全市场季报股东快照采集."""
    try:
        rd = date.fromisoformat(report_date_str) if report_date_str else None
        run_quarterly_pipeline(report_date=rd, limit=limit)
    except Exception as exc:
        self.retry(exc=exc, countdown=300 * (self.request.retries + 1))
