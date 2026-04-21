"""资金维度数据模型.

覆盖 4 类资金信息源:
    1. 日频盘面    -> CapitalFlowDaily (scope: market/north/concept/industry/stock/limit_order)
    2. 北向持仓    -> NorthHoldDaily (单股北向持股变化)
    3. ETF 代理    -> EtfFlowDaily (国家队动向最强代理: 宽基 ETF 净申购)
    4. 公告事件    -> AnnouncementEvent (增减持/回购/举牌/股权激励)

季报股东与主力身份注册见 holder.py.
"""
from datetime import date as date_type, datetime
from sqlalchemy import String, Float, Date, DateTime, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class CapitalFlowDaily(Base):
    """日频盘面资金流——按 scope/scope_key 二级聚合."""
    __tablename__ = "capital_flow_daily"
    __table_args__ = (
        UniqueConstraint("trade_date", "scope", "scope_key", name="uq_capital_flow"),
        Index("ix_cf_date_scope", "trade_date", "scope"),
        Index("ix_cf_stock_date", "scope_key", "trade_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date_type] = mapped_column(Date, index=True)
    scope: Mapped[str] = mapped_column(String(16))
    scope_key: Mapped[str] = mapped_column(String(64), default="")
    data: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class NorthHoldDaily(Base):
    """北向资金单股持仓快照."""
    __tablename__ = "north_hold_daily"
    __table_args__ = (
        UniqueConstraint("trade_date", "stock_code", name="uq_north_hold"),
        Index("ix_nh_stock_date", "stock_code", "trade_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date_type] = mapped_column(Date, index=True)
    stock_code: Mapped[str] = mapped_column(String(10))
    stock_name: Mapped[str | None] = mapped_column(String(50))
    hold_shares: Mapped[float | None] = mapped_column(Float)
    hold_amount: Mapped[float | None] = mapped_column(Float)
    hold_pct: Mapped[float | None] = mapped_column(Float)
    chg_shares: Mapped[float | None] = mapped_column(Float)
    chg_amount: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class EtfFlowDaily(Base):
    """ETF 净申购代理变量——汇金救市靠扫宽基 ETF, 国家队动向最强代理."""
    __tablename__ = "etf_flow_daily"
    __table_args__ = (
        UniqueConstraint("trade_date", "etf_code", name="uq_etf_flow"),
        Index("ix_etf_date_code", "trade_date", "etf_code"),
        Index("ix_etf_category_date", "category", "trade_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date_type] = mapped_column(Date, index=True)
    etf_code: Mapped[str] = mapped_column(String(10))
    etf_name: Mapped[str | None] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(24), default="other")
    shares: Mapped[float | None] = mapped_column(Float)
    shares_change: Mapped[float | None] = mapped_column(Float)
    amount: Mapped[float | None] = mapped_column(Float)
    nav: Mapped[float | None] = mapped_column(Float)
    premium_rate: Mapped[float | None] = mapped_column(Float)
    inflow_estimate: Mapped[float | None] = mapped_column(Float)
    close: Mapped[float | None] = mapped_column(Float)
    change_pct: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class AnnouncementEvent(Base):
    """公告事件流——增减持 / 回购 / 举牌 / 股权激励."""
    __tablename__ = "announcement_event"
    __table_args__ = (
        Index("ix_ae_date_type", "trade_date", "event_type"),
        Index("ix_ae_stock_date", "stock_code", "trade_date"),
        Index("ix_ae_actor", "actor_type", "trade_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date_type] = mapped_column(Date, index=True)
    stock_code: Mapped[str] = mapped_column(String(10))
    stock_name: Mapped[str | None] = mapped_column(String(50))
    event_type: Mapped[str] = mapped_column(String(20))
    actor: Mapped[str | None] = mapped_column(String(120))
    actor_type: Mapped[str] = mapped_column(String(20), default="unknown")
    scale: Mapped[float | None] = mapped_column(Float)
    shares: Mapped[float | None] = mapped_column(Float)
    progress: Mapped[str | None] = mapped_column(String(20))
    detail: Mapped[dict | None] = mapped_column(JSONB)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(20)))
    source_url: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
