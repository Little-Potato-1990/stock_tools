from celery import Celery
from celery.schedules import crontab
from app.config import get_settings

settings = get_settings()

celery = Celery(
    "fupan_box",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery.conf.imports = (
    "app.tasks.daily",
    "app.tasks.intraday_scan",
    "app.tasks.ai_verify",
    "app.tasks.prewarm",
)
celery.conf.beat_schedule = {
    "daily-pipeline": {
        "task": "app.tasks.daily.run_pipeline_task",
        "schedule": crontab(hour=15, minute=35, day_of_week="1-5"),
    },
    # P3: 每日 16:00 自动跑 AI 预测 T+3 校验
    "ai-track-verify": {
        "task": "app.tasks.ai_verify.verify_ai_predictions_task",
        "schedule": crontab(hour=16, minute=0, day_of_week="1-5"),
    },
    # P2: 9:30 - 11:30 每分钟扫描盘中异动
    "intraday-scan-morning": {
        "task": "app.tasks.intraday_scan.intraday_scan_task",
        "schedule": crontab(minute="*/1", hour="9-11", day_of_week="1-5"),
    },
    # P2: 13:00 - 15:00 每分钟扫描盘中异动
    "intraday-scan-afternoon": {
        "task": "app.tasks.intraday_scan.intraday_scan_task",
        "schedule": crontab(minute="*/1", hour="13-14", day_of_week="1-5"),
    },
    # AI 预热: pipeline 完成后 5min, 大盘四类 brief
    "prewarm-market-briefs": {
        "task": "app.tasks.prewarm.prewarm_market_briefs",
        "schedule": crontab(hour=15, minute=40, day_of_week="1-5"),
    },
    # AI 预热: why_rose 批量 (涨停 + 涨跌幅 top30)
    "prewarm-why-rose": {
        "task": "app.tasks.prewarm.prewarm_why_rose",
        "schedule": crontab(hour=15, minute=45, day_of_week="1-5"),
    },
    # AI 预热: debate (大盘 + top10 题材)
    "prewarm-debate": {
        "task": "app.tasks.prewarm.prewarm_debate",
        "schedule": crontab(hour=15, minute=50, day_of_week="1-5"),
    },
}
celery.conf.timezone = "Asia/Shanghai"
