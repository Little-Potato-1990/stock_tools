from sqlalchemy import String, Integer, Float, Text, Date, DateTime, Boolean, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, datetime
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    tier: Mapped[str] = mapped_column(String(20), default="free")  # free / monthly / yearly
    ai_quota_daily: Mapped[int] = mapped_column(Integer, default=5)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now, onupdate=datetime.now)


class UserWatchlist(Base):
    """自选股"""
    __tablename__ = "user_watchlist"
    __table_args__ = (
        UniqueConstraint("user_id", "stock_code", name="uq_watchlist"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    stock_code: Mapped[str] = mapped_column(String(10))
    note: Mapped[str | None] = mapped_column(Text)
    ai_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    dashboard_layout: Mapped[dict | None] = mapped_column(JSONB)
    ai_style: Mapped[str] = mapped_column(String(20), default="concise")  # concise / detailed
    theme: Mapped[str] = mapped_column(String(20), default="dark")
    active_skill_ref: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # 默认激活的投资体系：'system:<slug>' 或 'user:<id>'，None=中立
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now, onupdate=datetime.now)


class UserTrade(Base):
    """用户交易记录 (round-trip 单笔已平仓). MVP 版本.

    模式诊断核心字段:
        intraday_chg_at_buy: 介入时刻当日涨幅 % — 识别"追高"模式
        holding_minutes:     持仓时长 — 识别"短线被洗"
        pnl_pct:             单笔盈亏率 % — 胜率统计
    """
    __tablename__ = "user_trades"
    __table_args__ = (
        Index("ix_user_trades_user_date", "user_id", "trade_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    code: Mapped[str] = mapped_column(String(10), index=True)
    name: Mapped[str | None] = mapped_column(String(50))
    buy_price: Mapped[float] = mapped_column(Float)
    sell_price: Mapped[float] = mapped_column(Float)
    qty: Mapped[int] = mapped_column(Integer)
    intraday_chg_at_buy: Mapped[float | None] = mapped_column(Float)
    holding_minutes: Mapped[int | None] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(Text)
    pnl: Mapped[float] = mapped_column(Float)
    pnl_pct: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class UserSkill(Base):
    """用户自定义投资体系（Skill）。

    自由文本 body_markdown 是体系的"灵魂"；derived_rules 由 LLM 抽取，
    供 screener 做硬过滤+软评分。用户可手工校对 derived_rules，校对后
    rules_user_edited=True，下次重抽 body 时不自动覆盖。
    """
    __tablename__ = "user_skills"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_user_skill_slug"),
        Index("ix_user_skills_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    slug: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(80))
    icon: Mapped[str | None] = mapped_column(String(20))
    body_markdown: Mapped[str] = mapped_column(Text)
    completeness_warnings: Mapped[list | None] = mapped_column(JSONB)
    derived_rules: Mapped[dict | None] = mapped_column(JSONB)
    rules_user_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    rules_extracted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now, onupdate=datetime.now)


class SkillScanRun(Base):
    """一次"用我的体系扫一遍"的执行记录。

    rules_snapshot 保留扫描时使用的 derived_rules，candidates 含每只
    股票的命中因子与 LLM 体系视角点评。
    """
    __tablename__ = "skill_scan_runs"
    __table_args__ = (
        Index("ix_skill_scan_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    skill_ref: Mapped[str] = mapped_column(String(80))  # 'system:xxx' or 'user:42'
    skill_name_snapshot: Mapped[str] = mapped_column(String(80))
    universe: Mapped[str] = mapped_column(String(60))   # 'hs300' / 'all' / 'industry:xxx' / 'theme:xxx' / 'watchlist'
    top_n: Mapped[int] = mapped_column(Integer, default=30)
    rules_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    candidates: Mapped[list | None] = mapped_column(JSONB)
    summary: Mapped[str | None] = mapped_column(Text)
    pre_filter_count: Mapped[int | None] = mapped_column(Integer)
    final_count: Mapped[int | None] = mapped_column(Integer)
    cost_estimate_yuan: Mapped[float | None] = mapped_column(Float)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running/done/failed
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now, index=True)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now, onupdate=datetime.now)


class UserAIQuotaLog(Base):
    """按动作 + 按 tier 记录 AI 调用, 用于配额统计.

    action 枚举:
        chat              : AI 副驾对话
        why_rose          : 为什么涨/跌
        debate            : 多空辩论
        brief             : 今日复盘 brief (共享, 不计个人配额)
        trade_review      : 我的交易复盘
        anomaly           : 盘中异动 (主动推送, 不计个人配额)
    """
    __tablename__ = "user_ai_quota_log"
    __table_args__ = (
        Index("ix_quota_user_date", "user_id", "log_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    log_date: Mapped[date] = mapped_column(Date, index=True, default=date.today)
    action: Mapped[str] = mapped_column(String(30))
    model: Mapped[str | None] = mapped_column(String(50))
    cost_pts: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
