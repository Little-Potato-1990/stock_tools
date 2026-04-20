from sqlalchemy import String, Integer, Float, Text, Date, ForeignKey, UniqueConstraint, Index
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
