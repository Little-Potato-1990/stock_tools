"""用户操作计划 (Plan Pool).

把"用户脑子里的想法"结构化:
    我准备 [何时] 对 [哪只股] 做 [什么操作], 触发条件是 [...].
盘中 celery 后台扫描, 触发即落库 + 复用 IntradayAnomaly 通道推到 AnomalyBell.

trigger_conditions / invalid_conditions 是 JSONB list, 支持的 type:
    price_above       {value: float, label: str}      价格上穿
    price_below       {value: float, label: str}      价格跌破
    change_pct_above  {value: float, label: str}      涨幅 >= X%
    change_pct_below  {value: float, label: str}      跌幅 <= X% (负数)
    limit_up          {label: str}                    冲到涨停 (>= 9.7%)
    limit_up_break    {label: str}                    涨停后打开
任一 trigger_condition 命中即整个 plan 状态置为 triggered (OR 关系).
任一 invalid_condition 命中即 plan 失效, 状态置为 expired.

status 流转:
    active    -> 监控中, beat 任务每分钟扫
    triggered -> 至少一个条件命中, 等用户操作
    executed  -> 用户已实际下单 (手动标记)
    expired   -> 到期 / invalid 触发 / 用户主动放弃
    cancelled -> 用户主动取消
"""
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Text, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class UserPlan(Base):
    __tablename__ = "user_plans"
    __table_args__ = (
        Index("ix_user_plans_user_status", "user_id", "status"),
        Index("ix_user_plans_code", "code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    code: Mapped[str] = mapped_column(String(10))
    name: Mapped[str | None] = mapped_column(String(50))

    direction: Mapped[str] = mapped_column(String(10), default="buy")
    trigger_conditions: Mapped[list | None] = mapped_column(JSONB, default=list)
    position_plan: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    stop_loss_pct: Mapped[float | None] = mapped_column(Float)
    take_profit_pct: Mapped[float | None] = mapped_column(Float)
    invalid_conditions: Mapped[list | None] = mapped_column(JSONB, default=list)
    notes: Mapped[str | None] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    first_triggered_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, onupdate=datetime.now
    )


class UserPlanTrigger(Base):
    """每次条件命中记一行. 用 (plan_id, condition_idx, trade_date) 在 task 层做幂等去重."""

    __tablename__ = "user_plan_triggers"
    __table_args__ = (
        Index("ix_user_plan_triggers_plan", "plan_id"),
        Index("ix_user_plan_triggers_user_date", "user_id", "trade_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("user_plans.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    trade_date: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    condition_idx: Mapped[int] = mapped_column(Integer)
    condition_kind: Mapped[str | None] = mapped_column(String(20))  # trigger / invalid
    condition_type: Mapped[str | None] = mapped_column(String(30))
    condition_label: Mapped[str | None] = mapped_column(String(100))
    price: Mapped[float | None] = mapped_column(Float)
    change_pct: Mapped[float | None] = mapped_column(Float)


class UserTradingProfile(Base):
    """用户交易风格画像（长期持久化，供 AI 草案计划参考）."""

    __tablename__ = "user_trading_profiles"
    __table_args__ = (
        Index("ix_user_trading_profiles_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    profile_json: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class UserPlanVersion(Base):
    """AI 草案计划 / 用户确认计划 的版本快照."""

    __tablename__ = "user_plan_versions"
    __table_args__ = (
        Index("ix_user_plan_versions_user_date", "user_id", "plan_date"),
        Index("ix_user_plan_versions_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plan_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="ai_draft", index=True)  # ai_draft / user_final
    model: Mapped[str | None] = mapped_column(String(60))
    content_json: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    profile_snapshot: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    source_version_id: Mapped[int | None] = mapped_column(ForeignKey("user_plan_versions.id"))
    review_trade_date: Mapped[date | None] = mapped_column(Date)
    user_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class UserPlanFeedback(Base):
    """计划执行反馈（按用户+计划日幂等落库）."""

    __tablename__ = "user_plan_feedback"
    __table_args__ = (
        UniqueConstraint("user_id", "plan_date", name="uq_user_plan_feedback_user_date"),
        Index("ix_user_plan_feedback_user_date", "user_id", "plan_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plan_date: Mapped[date] = mapped_column(Date, index=True)
    plan_version_id: Mapped[int | None] = mapped_column(ForeignKey("user_plan_versions.id"))
    planned_count: Mapped[int] = mapped_column(Integer, default=0)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    miss_count: Mapped[int] = mapped_column(Integer, default=0)
    unexpected_count: Mapped[int] = mapped_column(Integer, default=0)
    net_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    feedback_json: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
