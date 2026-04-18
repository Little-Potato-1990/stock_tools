from celery import Celery
from celery.schedules import crontab
from app.config import get_settings

settings = get_settings()

celery = Celery("fupan_box", broker=settings.redis_url, backend=settings.redis_url)

celery.conf.beat_schedule = {
    "daily-pipeline": {
        "task": "app.tasks.daily.run_pipeline_task",
        "schedule": crontab(hour=15, minute=35, day_of_week="1-5"),
    },
}
celery.conf.timezone = "Asia/Shanghai"
