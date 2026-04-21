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
    "app.tasks.plan_check",
    "app.tasks.news_ingest",
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
    # P0-用户计划池触发: 复用 intraday_scan 的 spot 窗口, 每分钟检查一次
    "plan-check-morning": {
        "task": "app.tasks.plan_check.plan_check_task",
        "schedule": crontab(minute="*/1", hour="9-11", day_of_week="1-5"),
    },
    "plan-check-afternoon": {
        "task": "app.tasks.plan_check.plan_check_task",
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
    # === Phase 1 新闻聚合 ===
    # 全天 24x7 每 30 分钟拉一次新闻 (兼顾盘后政策 / 海外消息)
    "news-ingest-30min": {
        "task": "app.tasks.news_ingest.ingest_news_task",
        "schedule": crontab(minute="*/30"),
    },
    # 盘中 9:00-15:00 每 5 分钟一次, 高频抓热点
    "news-ingest-intraday-morning": {
        "task": "app.tasks.news_ingest.ingest_news_task",
        "schedule": crontab(minute="*/5", hour="9-11", day_of_week="1-5"),
        "kwargs": {"window_hours": 1.0, "do_tag": True},
    },
    "news-ingest-intraday-afternoon": {
        "task": "app.tasks.news_ingest.ingest_news_task",
        "schedule": crontab(minute="*/5", hour="13-14", day_of_week="1-5"),
        "kwargs": {"window_hours": 1.0, "do_tag": True},
    },
    # 每日 17:00 跑一次打标补漏 (扫近 48h ai_tagged_at IS NULL)
    "news-tag-backfill-daily": {
        "task": "app.tasks.news_ingest.tag_news_backfill_task",
        "schedule": crontab(hour=17, minute=0),
    },
    # Phase 4 RAG: 每 5 分钟把 pending 新闻向量化 (单轮上限由 settings 控)
    "news-embed-5min": {
        "task": "app.tasks.news_ingest.embed_news_task",
        "schedule": crontab(minute="*/5"),
    },
    # 新闻 brief 预热 (盘前 8:30, 盘中每小时, 盘后 15:55)
    "prewarm-news-brief-premarket": {
        "task": "app.tasks.prewarm.prewarm_news_brief",
        "schedule": crontab(hour=8, minute=30, day_of_week="1-5"),
    },
    "prewarm-news-brief-intraday": {
        "task": "app.tasks.prewarm.prewarm_news_brief",
        "schedule": crontab(minute=0, hour="9-14", day_of_week="1-5"),
    },
    "prewarm-news-brief-close": {
        "task": "app.tasks.prewarm.prewarm_news_brief",
        "schedule": crontab(hour=15, minute=55, day_of_week="1-5"),
    },
}
celery.conf.timezone = "Asia/Shanghai"
