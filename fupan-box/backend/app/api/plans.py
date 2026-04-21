"""计划池 (Plan Pool) API.

POST   /api/plans                       创建
GET    /api/plans                       列表 (status/code 过滤)
GET    /api/plans/{id}                  详情 (含触发历史)
PUT    /api/plans/{id}                  更新
DELETE /api/plans/{id}                  删除
GET    /api/plans/triggers/today        今日触发列表 (供首页 / 浮动速览用)
GET    /api/plans/badge                 徽章计数 (active / triggered / today_triggers)
POST   /api/plans/check-triggers        手动触发一次扫描 (调试 / celery 入口复用)
"""
from __future__ import annotations

from datetime import date as date_type, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.database import get_db
from app.models.plan import UserPlan, UserPlanTrigger
from app.models.user import User

router = APIRouter()


# ---------------------- schemas ----------------------


class TriggerCondition(BaseModel):
    type: str = Field(..., min_length=1, max_length=30)
    value: float | None = None
    label: str | None = None


class PlanCreate(BaseModel):
    code: str = Field(..., min_length=4, max_length=10)
    name: str | None = None
    direction: str = Field("buy", pattern="^(buy|sell|add|reduce)$")
    trigger_conditions: list[TriggerCondition] = []
    position_plan: dict[str, Any] | None = None
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None
    invalid_conditions: list[TriggerCondition] = []
    notes: str | None = None
    expires_at: datetime | None = None


class PlanUpdate(BaseModel):
    name: str | None = None
    status: str | None = Field(None, pattern="^(active|triggered|executed|expired|cancelled)$")
    direction: str | None = Field(None, pattern="^(buy|sell|add|reduce)$")
    trigger_conditions: list[TriggerCondition] | None = None
    position_plan: dict[str, Any] | None = None
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None
    invalid_conditions: list[TriggerCondition] | None = None
    notes: str | None = None
    expires_at: datetime | None = None


class TriggerOut(BaseModel):
    id: int
    plan_id: int
    trade_date: date_type
    triggered_at: datetime
    condition_idx: int
    condition_kind: str | None
    condition_type: str | None
    condition_label: str | None
    price: float | None
    change_pct: float | None


class PlanOut(BaseModel):
    id: int
    code: str
    name: str | None
    direction: str
    trigger_conditions: list[dict[str, Any]] | None
    position_plan: dict[str, Any] | None
    stop_loss_pct: float | None
    take_profit_pct: float | None
    invalid_conditions: list[dict[str, Any]] | None
    notes: str | None
    status: str
    first_triggered_at: datetime | None
    last_checked_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    triggered_today_count: int = 0


# ---------------------- helpers ----------------------


def _to_out(p: UserPlan, today_count: int) -> PlanOut:
    return PlanOut(
        id=p.id,
        code=p.code,
        name=p.name,
        direction=p.direction,
        trigger_conditions=list(p.trigger_conditions or []),
        position_plan=dict(p.position_plan or {}),
        stop_loss_pct=p.stop_loss_pct,
        take_profit_pct=p.take_profit_pct,
        invalid_conditions=list(p.invalid_conditions or []),
        notes=p.notes,
        status=p.status,
        first_triggered_at=p.first_triggered_at,
        last_checked_at=p.last_checked_at,
        expires_at=p.expires_at,
        created_at=p.created_at,
        updated_at=p.updated_at,
        triggered_today_count=today_count,
    )


def _trigger_to_out(t: UserPlanTrigger) -> TriggerOut:
    return TriggerOut(
        id=t.id,
        plan_id=t.plan_id,
        trade_date=t.trade_date,
        triggered_at=t.triggered_at,
        condition_idx=t.condition_idx,
        condition_kind=t.condition_kind,
        condition_type=t.condition_type,
        condition_label=t.condition_label,
        price=t.price,
        change_pct=t.change_pct,
    )


async def _today_count_map(
    db: AsyncSession, user_id: int, plan_ids: list[int]
) -> dict[int, int]:
    if not plan_ids:
        return {}
    today = date_type.today()
    rows = await db.execute(
        select(UserPlanTrigger.plan_id, func.count(UserPlanTrigger.id))
        .where(
            UserPlanTrigger.user_id == user_id,
            UserPlanTrigger.trade_date == today,
            UserPlanTrigger.plan_id.in_(plan_ids),
        )
        .group_by(UserPlanTrigger.plan_id)
    )
    return {pid: int(c) for pid, c in rows.all()}


# ---------------------- routes ----------------------


@router.post("/", response_model=PlanOut)
async def create_plan(
    req: PlanCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = UserPlan(
        user_id=user.id,
        code=req.code,
        name=req.name,
        direction=req.direction,
        trigger_conditions=[c.model_dump() for c in req.trigger_conditions],
        position_plan=req.position_plan or {},
        stop_loss_pct=req.stop_loss_pct,
        take_profit_pct=req.take_profit_pct,
        invalid_conditions=[c.model_dump() for c in req.invalid_conditions],
        notes=req.notes,
        expires_at=req.expires_at,
        status="active",
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return _to_out(plan, 0)


@router.get("/", response_model=list[PlanOut])
async def list_plans(
    status: str | None = Query(None),
    code: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(UserPlan).where(UserPlan.user_id == user.id)
    if status:
        stmt = stmt.where(UserPlan.status == status)
    if code:
        stmt = stmt.where(UserPlan.code == code)
    stmt = stmt.order_by(desc(UserPlan.updated_at))
    result = await db.execute(stmt)
    plans = list(result.scalars().all())
    counts = await _today_count_map(db, user.id, [p.id for p in plans])
    return [_to_out(p, counts.get(p.id, 0)) for p in plans]


class PlanDetailOut(BaseModel):
    plan: PlanOut
    triggers: list[TriggerOut]


@router.get("/{plan_id}", response_model=PlanDetailOut)
async def get_plan_detail(
    plan_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.scalar(
        select(UserPlan).where(UserPlan.id == plan_id, UserPlan.user_id == user.id)
    )
    if not plan:
        raise HTTPException(404, "Plan not found")
    rows = await db.execute(
        select(UserPlanTrigger)
        .where(UserPlanTrigger.plan_id == plan.id)
        .order_by(desc(UserPlanTrigger.triggered_at))
        .limit(50)
    )
    triggers = [_trigger_to_out(r) for r in rows.scalars().all()]
    counts = await _today_count_map(db, user.id, [plan.id])
    return PlanDetailOut(plan=_to_out(plan, counts.get(plan.id, 0)), triggers=triggers)


@router.put("/{plan_id}", response_model=PlanOut)
async def update_plan(
    plan_id: int,
    req: PlanUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.scalar(
        select(UserPlan).where(UserPlan.id == plan_id, UserPlan.user_id == user.id)
    )
    if not plan:
        raise HTTPException(404, "Plan not found")
    data = req.model_dump(exclude_unset=True)
    for k in ("name", "status", "direction", "stop_loss_pct", "take_profit_pct", "notes", "expires_at"):
        if k in data:
            setattr(plan, k, data[k])
    if "trigger_conditions" in data and data["trigger_conditions"] is not None:
        plan.trigger_conditions = [
            c.model_dump() if hasattr(c, "model_dump") else c
            for c in (data["trigger_conditions"] or [])
        ]
    if "invalid_conditions" in data and data["invalid_conditions"] is not None:
        plan.invalid_conditions = [
            c.model_dump() if hasattr(c, "model_dump") else c
            for c in (data["invalid_conditions"] or [])
        ]
    if "position_plan" in data and data["position_plan"] is not None:
        plan.position_plan = data["position_plan"]
    plan.updated_at = datetime.now()
    await db.commit()
    await db.refresh(plan)
    counts = await _today_count_map(db, user.id, [plan.id])
    return _to_out(plan, counts.get(plan.id, 0))


@router.delete("/{plan_id}")
async def delete_plan(
    plan_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.scalar(
        select(UserPlan).where(UserPlan.id == plan_id, UserPlan.user_id == user.id)
    )
    if not plan:
        raise HTTPException(404, "Plan not found")
    # 先删触发历史 (手动级联, 避免依赖 DB 级 ON DELETE CASCADE 配置差异)
    await db.execute(
        UserPlanTrigger.__table__.delete().where(UserPlanTrigger.plan_id == plan.id)
    )
    await db.delete(plan)
    await db.commit()
    return {"ok": True}


# ----- 浮动速览 / 候选池标记 共用 -----


@router.get("/triggers/today", response_model=list[TriggerOut])
async def today_triggers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date_type.today()
    rows = await db.execute(
        select(UserPlanTrigger)
        .where(
            and_(
                UserPlanTrigger.user_id == user.id,
                UserPlanTrigger.trade_date == today,
            )
        )
        .order_by(desc(UserPlanTrigger.triggered_at))
        .limit(100)
    )
    return [_trigger_to_out(r) for r in rows.scalars().all()]


class BadgeOut(BaseModel):
    active: int
    triggered: int
    today_triggers: int
    triggered_codes: list[str]


@router.get("/badge", response_model=BadgeOut)
async def get_badge(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """供 MyDigestFloating / 候选池 icon 标记用的小聚合."""
    active = await db.scalar(
        select(func.count(UserPlan.id)).where(
            UserPlan.user_id == user.id, UserPlan.status == "active"
        )
    )
    triggered = await db.scalar(
        select(func.count(UserPlan.id)).where(
            UserPlan.user_id == user.id, UserPlan.status == "triggered"
        )
    )
    today = date_type.today()
    today_cnt = await db.scalar(
        select(func.count(UserPlanTrigger.id)).where(
            UserPlanTrigger.user_id == user.id,
            UserPlanTrigger.trade_date == today,
        )
    )
    code_rows = await db.execute(
        select(UserPlan.code).where(
            UserPlan.user_id == user.id,
            UserPlan.status.in_(["active", "triggered"]),
        )
    )
    codes = sorted({c for (c,) in code_rows.all() if c})
    return BadgeOut(
        active=int(active or 0),
        triggered=int(triggered or 0),
        today_triggers=int(today_cnt or 0),
        triggered_codes=codes,
    )


@router.post("/check-triggers")
async def check_triggers_now(
    user: User = Depends(get_current_user),
):
    """手动触发一次盘中扫描. 调试用 / 也可以前端 P0 阶段直接轮询走这条."""
    # 用 sync engine 调 task 主体, 避免 celery 不在线时也能跑
    from app.tasks.plan_check import run_plan_check_sync

    result = run_plan_check_sync(user_id=user.id)
    return result
