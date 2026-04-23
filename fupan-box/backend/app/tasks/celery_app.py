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
    "app.tasks.quarterly",
    "app.tasks.midlong",
    "app.tasks.external_pull",
    "app.tasks.peruser_prewarm",
    "app.tasks.market",
)
celery.conf.beat_schedule = {
    "daily-pipeline": {
        "task": "app.tasks.daily.run_pipeline_task",
        # 推后到 16:00, 等 tushare moneyflow_dc/moneyflow_ind_dc 当日数据落库
        "schedule": crontab(hour=16, minute=0, day_of_week="1-5"),
    },
    # P3: 每日 16:25 自动跑 AI 预测 T+3 校验 (跟在 daily-pipeline 16:00 之后, 与其他 16:xx 任务错峰)
    "ai-track-verify": {
        "task": "app.tasks.ai_verify.verify_ai_predictions_task",
        "schedule": crontab(hour=16, minute=25, day_of_week="1-5"),
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
    # AI 预热: LHB brief — daily-pipeline 之后 15min
    "prewarm-lhb-brief": {
        "task": "app.tasks.prewarm.prewarm_lhb_brief",
        "schedule": crontab(hour=16, minute=15, day_of_week="1-5"),
    },
    # AI 预热: why_rose 白名单 universe (800-1500 股)
    "prewarm-why-rose": {
        "task": "app.tasks.prewarm.prewarm_why_rose",
        "schedule": crontab(hour=16, minute=20, day_of_week="1-5"),
    },
    # AI 预热: debate (大盘 + top10 题材 + universe 个股)
    "prewarm-debate": {
        "task": "app.tasks.prewarm.prewarm_debate",
        "schedule": crontab(hour=17, minute=0, day_of_week="1-5"),
    },
    # 个股 7 维 context 预热 (universe, 落 PG 24h, 不含 LLM)
    "prewarm-stock-context": {
        "task": "app.tasks.prewarm.prewarm_stock_context",
        "schedule": crontab(hour=17, minute=40, day_of_week="1-5"),
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
    # 季报股东快照——每天 20:00 扫一次(命中即跳过, 成本低), 月 1 号 20:30 兜底
    "quarterly-holder-pipeline": {
        "task": "app.tasks.quarterly.run_quarterly_holder_task",
        "schedule": crontab(hour=20, minute=0, day_of_week="1-5"),
    },
    "quarterly-holder-monthly-fallback": {
        "task": "app.tasks.quarterly.run_quarterly_holder_task",
        "schedule": crontab(hour=20, minute=30, day_of_month="1"),
    },
    # 主力身份 brief 预热: 季报变化慢, 每天 16:10 跑一次即可
    "prewarm-institutional-brief": {
        "task": "app.tasks.prewarm.prewarm_institutional_brief",
        "schedule": crontab(hour=16, minute=10, day_of_week="1-5"),
    },
    # === 中长视角 (Phase 1) ===
    # 估值快照: 每日 18:30 (daily pipeline 之后), 拉全市场 daily_basic 全字段
    "midlong-valuation-daily": {
        "task": "app.tasks.midlong.run_valuation_task",
        "schedule": crontab(hour=18, minute=30, day_of_week="1-5"),
    },
    # 5年/3年 PE/PB 分位重算: 每月 5 号 22:00
    "midlong-valuation-percentile-monthly": {
        "task": "app.tasks.midlong.recompute_valuation_pct_task",
        "schedule": crontab(hour=22, minute=0, day_of_month="5"),
    },
    # 财务指标 + 业绩预告 + 业绩快报: 每月 5/15/30 日 20:00 跑一次
    "midlong-fundamentals-monthly": {
        "task": "app.tasks.midlong.run_fundamentals_task",
        "schedule": crontab(hour=20, minute=0, day_of_month="5,15,30"),
    },
    # 卖方一致预期: 每周一 18:00
    "midlong-consensus-weekly": {
        "task": "app.tasks.midlong.run_consensus_task",
        "schedule": crontab(hour=18, minute=0, day_of_week="1"),
    },
    # === 中长视角 brief 预热 (Phase 2) ===
    # 三视角一句话 brief: 每日 17:30, 跑 top 50, 给 Drawer PerspectiveBriefBar 用
    "prewarm-multi-perspective-daily": {
        "task": "app.tasks.prewarm.prewarm_multi_perspective",
        "schedule": crontab(hour=17, minute=30, day_of_week="1-5"),
    },
    # 波段 brief 预热: 每日 18:00, 跑 top 50
    "prewarm-swing-brief-daily": {
        "task": "app.tasks.prewarm.prewarm_swing_brief",
        "schedule": crontab(hour=18, minute=0, day_of_week="1-5"),
    },
    # 长线 brief 预热: 改为每日 19:00 跑 universe (PG TTL 7d, 命中即跳过)
    "prewarm-long-term-brief-daily": {
        "task": "app.tasks.prewarm.prewarm_long_term_brief",
        "schedule": crontab(hour=19, minute=0, day_of_week="1-5"),
    },
    # === 外部数据 (akshare / adapter) 定时拉到 redis, API 只读 ===
    # 盘中 9-14 每 5min: 主力资金流 + 人气概念
    "external-fund-flow-5min-morning": {
        "task": "app.tasks.external_pull.pull_fund_flow",
        "schedule": crontab(minute="*/5", hour="9-11", day_of_week="1-5"),
    },
    "external-fund-flow-5min-afternoon": {
        "task": "app.tasks.external_pull.pull_fund_flow",
        "schedule": crontab(minute="*/5", hour="13-14", day_of_week="1-5"),
    },
    "external-hot-concept-5min-morning": {
        "task": "app.tasks.external_pull.pull_hot_concept",
        "schedule": crontab(minute="*/5", hour="9-11", day_of_week="1-5"),
    },
    "external-hot-concept-5min-afternoon": {
        "task": "app.tasks.external_pull.pull_hot_concept",
        "schedule": crontab(minute="*/5", hour="13-14", day_of_week="1-5"),
    },
    # 盘前 9:25 + 盘后 15:30: 板块列表 (概念 + 行业)
    "external-all-boards-premarket": {
        "task": "app.tasks.external_pull.pull_all_boards",
        "schedule": crontab(hour=9, minute=25, day_of_week="1-5"),
    },
    "external-all-boards-postclose": {
        "task": "app.tasks.external_pull.pull_all_boards",
        "schedule": crontab(hour=15, minute=30, day_of_week="1-5"),
    },
    # 盘后 16:30: 当日 top 30 题材 theme-detail 成分预拉 (与 daily/lhb/verify 错峰)
    "external-theme-detail-postclose": {
        "task": "app.tasks.external_pull.pull_theme_detail",
        "schedule": crontab(hour=16, minute=30, day_of_week="1-5"),
    },
    # === Per-user 夜间预热 21:00: 活跃用户自选股 brief 全量预热 ===
    "peruser-nightly-prewarm": {
        "task": "app.tasks.peruser_prewarm.prewarm_active_users",
        "schedule": crontab(hour=21, minute=0, day_of_week="1-5"),
    },
    # 物化视图：盘中每 5 分钟刷新 warm rankings（与存储过程 refresh_warm_views 对齐）
    "refresh_warm_views": {
        "task": "app.tasks.market.refresh_warm_views",
        "schedule": crontab(minute="*/5", hour="9-15", day_of_week="1-5"),
    },
}
celery.conf.timezone = "Asia/Shanghai"
