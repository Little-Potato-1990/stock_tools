"""盘中计划池触发扫描.

每分钟跑 (跟 intraday_scan 同节奏):
1. 复用 intraday.anomaly_detector 的 _SNAPSHOT_WINDOW 拿到当前 + ~5min 前 spot.
2. 拉所有 status=active 的 user_plans.
3. 对每个 plan, 用 check_engine.evaluate_plan 算命中.
4. 命中的 (plan_id + condition_idx + trade_date) 在 user_plan_triggers 上去重后落库.
5. 命中 trigger 类条件: 把 plan.status 置为 "triggered", first_triggered_at 写一次.
   命中 invalid 类条件: plan.status 置为 "expired".
6. last_checked_at 全员刷一下.

不调 LLM, 不发邮件 — 推送通道是前端轮询 /api/plans/badge.
"""
from __future__ import annotations

import logging
from datetime import date as date_type, datetime, time
from typing import Any

from app.tasks.celery_app import celery

logger = logging.getLogger(__name__)


def _is_trading_now() -> bool:
    now = datetime.now().time()
    return (time(9, 30) <= now <= time(11, 30)) or (time(13, 0) <= now <= time(15, 0))


def _get_window_quotes() -> tuple[dict[str, dict[str, Any]] | None, dict[str, dict[str, Any]] | None]:
    """从 intraday_scan 的 snapshot 窗口里拿 (prev, cur). 没有则 (None, None)."""
    from app.intraday.anomaly_detector import _SNAPSHOT_WINDOW

    if not _SNAPSHOT_WINDOW:
        return None, None
    cur = _SNAPSHOT_WINDOW[-1][1]
    prev = _SNAPSHOT_WINDOW[0][1] if len(_SNAPSHOT_WINDOW) >= 2 else None
    return prev, cur


def _ensure_snapshot() -> dict[str, dict[str, Any]] | None:
    """如果窗口空 (intraday_scan 还没跑), 自己拉一份 spot 兜底."""
    from app.intraday.anomaly_detector import _fetch_spot_snapshot, _SNAPSHOT_WINDOW
    import time as time_mod

    if _SNAPSHOT_WINDOW:
        return _SNAPSHOT_WINDOW[-1][1]
    snap = _fetch_spot_snapshot()
    if snap:
        _SNAPSHOT_WINDOW.append((time_mod.time(), snap))
    return snap


def run_plan_check_sync(
    user_id: int | None = None,
    fake_cur: dict[str, dict[str, Any]] | None = None,
    fake_prev: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """主流程. 同步调用, 给 celery + API 复用.

    user_id 给定时只检查该用户的 plans (调试 / 前端手动触发).
    fake_cur / fake_prev 用于单测.
    """
    from sqlalchemy import create_engine, select, and_
    from sqlalchemy.orm import Session

    from app.config import get_settings
    from app.models.plan import UserPlan, UserPlanTrigger
    from app.plans.check_engine import evaluate_plan

    if fake_cur is not None or fake_prev is not None:
        cur = fake_cur
        prev = fake_prev
    else:
        prev, cur = _get_window_quotes()
        if cur is None:
            cur = _ensure_snapshot()

    if not cur:
        return {"status": "no_quote", "checked": 0, "new_triggers": 0}

    settings = get_settings()
    engine = create_engine(settings.database_url_sync)
    today = date_type.today()
    now = datetime.now()

    new_trigger_count = 0
    new_invalid_count = 0
    plans_checked = 0
    plans_status_changed = 0

    try:
        with Session(engine) as session:
            stmt = select(UserPlan).where(UserPlan.status == "active")
            if user_id is not None:
                stmt = stmt.where(UserPlan.user_id == user_id)
            plans = session.execute(stmt).scalars().all()

            for p in plans:
                plans_checked += 1
                p.last_checked_at = now
                cur_q = cur.get(p.code) if cur else None
                if not cur_q:
                    continue
                prev_q = prev.get(p.code) if prev else None
                hits = evaluate_plan(
                    p.trigger_conditions, p.invalid_conditions, prev_q, cur_q
                )
                if not hits:
                    continue

                trigger_hit_in_loop = False
                invalid_hit_in_loop = False
                for h in hits:
                    # 幂等: (plan_id, condition_kind, condition_idx, trade_date) 当日唯一
                    exists = session.execute(
                        select(UserPlanTrigger.id).where(
                            and_(
                                UserPlanTrigger.plan_id == p.id,
                                UserPlanTrigger.trade_date == today,
                                UserPlanTrigger.condition_idx == h.condition_idx,
                                UserPlanTrigger.condition_kind == h.condition_kind,
                            )
                        ).limit(1)
                    ).scalar_one_or_none()
                    if exists:
                        continue
                    row = UserPlanTrigger(
                        plan_id=p.id,
                        user_id=p.user_id,
                        trade_date=today,
                        triggered_at=now,
                        condition_idx=h.condition_idx,
                        condition_kind=h.condition_kind,
                        condition_type=h.condition_type,
                        condition_label=h.label,
                        price=h.price,
                        change_pct=h.change_pct,
                    )
                    session.add(row)
                    if h.condition_kind == "trigger":
                        new_trigger_count += 1
                        trigger_hit_in_loop = True
                    elif h.condition_kind == "invalid":
                        new_invalid_count += 1
                        invalid_hit_in_loop = True

                # 状态推进 — invalid 优先级高于 trigger
                if invalid_hit_in_loop and p.status != "expired":
                    p.status = "expired"
                    plans_status_changed += 1
                elif trigger_hit_in_loop and p.status == "active":
                    p.status = "triggered"
                    if not p.first_triggered_at:
                        p.first_triggered_at = now
                    plans_status_changed += 1

            session.commit()
    finally:
        engine.dispose()

    return {
        "status": "ok",
        "checked": plans_checked,
        "new_triggers": new_trigger_count,
        "new_invalids": new_invalid_count,
        "plans_status_changed": plans_status_changed,
    }


@celery.task(name="app.tasks.plan_check.plan_check_task")
def plan_check_task():
    if not _is_trading_now():
        return {"skipped": "not_trading_time"}
    try:
        result = run_plan_check_sync()
        if result.get("new_triggers", 0) > 0 or result.get("new_invalids", 0) > 0:
            logger.info(f"plan_check: {result}")
        return result
    except Exception as e:
        logger.exception(f"plan_check failed: {e}")
        return {"error": str(e)}
