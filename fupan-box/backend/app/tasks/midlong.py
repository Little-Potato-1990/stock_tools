"""中长视角数据 Celery 任务.

3 + 1 个任务:
- run_fundamentals_task         : 财务指标 + 业绩预告 + 业绩快报 (月度多次)
- run_valuation_task            : 单日估值快照 (每日盘后)
- recompute_valuation_pct_task  : 5 年/3 年 PE/PB 分位重算 (月度 1 次)
- run_consensus_task            : 卖方一致预期周聚合 (每周一)
"""
from datetime import date

from app.tasks.celery_app import celery
from app.pipeline.midlong_runner import (
    run_fundamentals_pipeline,
    run_valuation_pipeline,
    recompute_valuation_percentiles,
    run_consensus_pipeline,
)


@celery.task(
    name="app.tasks.midlong.run_fundamentals_task",
    bind=True, max_retries=2,
)
def run_fundamentals_task(self, limit: int | None = None, history_years: int = 5):
    try:
        run_fundamentals_pipeline(limit=limit, history_years=history_years)
    except Exception as exc:
        self.retry(exc=exc, countdown=600 * (self.request.retries + 1))


@celery.task(
    name="app.tasks.midlong.run_valuation_task",
    bind=True, max_retries=2,
)
def run_valuation_task(self, trade_date_str: str | None = None):
    try:
        td = date.fromisoformat(trade_date_str) if trade_date_str else None
        run_valuation_pipeline(trade_date=td)
    except Exception as exc:
        self.retry(exc=exc, countdown=300 * (self.request.retries + 1))


@celery.task(
    name="app.tasks.midlong.recompute_valuation_pct_task",
    bind=True, max_retries=1,
)
def recompute_valuation_pct_task(self, trade_date_str: str | None = None):
    try:
        td = date.fromisoformat(trade_date_str) if trade_date_str else None
        recompute_valuation_percentiles(trade_date=td)
    except Exception as exc:
        self.retry(exc=exc, countdown=900)


@celery.task(
    name="app.tasks.midlong.run_consensus_task",
    bind=True, max_retries=2,
)
def run_consensus_task(self, limit: int | None = None, week_end_str: str | None = None):
    try:
        we = date.fromisoformat(week_end_str) if week_end_str else None
        run_consensus_pipeline(limit=limit, week_end=we)
    except Exception as exc:
        self.retry(exc=exc, countdown=600 * (self.request.retries + 1))
