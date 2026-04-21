"""财务基本面数据模型——季报指标 + 业绩预告事件.

数据来源: tushare pro
- StockFundamentalsQuarterly  <- pro.fina_indicator (5000 积分)
- StockForecastEvent          <- pro.forecast / pro.express (2000 积分)

季报披露密集期: 4/30, 8/31, 10/31, 次年 4/30. ETL 频次: 每月 5/15/30 跑一次.
"""
from datetime import date as date_type, datetime
from sqlalchemy import String, Float, Date, DateTime, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class StockFundamentalsQuarterly(Base):
    """单股单季度核心财务指标——给长线 brief / 估值分析 / 财报观察 Tab 用."""
    __tablename__ = "stock_fundamentals_quarterly"
    __table_args__ = (
        UniqueConstraint("stock_code", "report_date", name="uq_fund_quarterly"),
        Index("ix_fund_stock_date", "stock_code", "report_date"),
        Index("ix_fund_date_roe", "report_date", "roe"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    report_date: Mapped[date_type] = mapped_column(Date, index=True)
    stock_code: Mapped[str] = mapped_column(String(10))

    revenue: Mapped[float | None] = mapped_column(Float)
    revenue_yoy: Mapped[float | None] = mapped_column(Float)

    net_profit: Mapped[float | None] = mapped_column(Float)
    net_profit_yoy: Mapped[float | None] = mapped_column(Float)

    gross_margin: Mapped[float | None] = mapped_column(Float)
    net_margin: Mapped[float | None] = mapped_column(Float)

    roe: Mapped[float | None] = mapped_column(Float)
    roa: Mapped[float | None] = mapped_column(Float)

    debt_ratio: Mapped[float | None] = mapped_column(Float)
    current_ratio: Mapped[float | None] = mapped_column(Float)

    cash_flow_op: Mapped[float | None] = mapped_column(Float)
    cash_flow_op_to_revenue: Mapped[float | None] = mapped_column(Float)

    eps: Mapped[float | None] = mapped_column(Float)
    bps: Mapped[float | None] = mapped_column(Float)

    ann_date: Mapped[date_type | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class StockForecastEvent(Base):
    """业绩预告 / 业绩快报事件.

    type: forecast(预告) / express(快报)
    nature: 预增 / 略增 / 续盈 / 扭亏 / 减亏 / 略减 / 预减 / 首亏 / 续亏 / 不确定
    """
    __tablename__ = "stock_forecast_event"
    __table_args__ = (
        UniqueConstraint("stock_code", "period", "type", "ann_date", name="uq_forecast_event"),
        Index("ix_fc_stock_period", "stock_code", "period"),
        Index("ix_fc_ann", "ann_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ann_date: Mapped[date_type] = mapped_column(Date, index=True)
    stock_code: Mapped[str] = mapped_column(String(10))
    period: Mapped[str] = mapped_column(String(8))
    type: Mapped[str] = mapped_column(String(16))

    nature: Mapped[str | None] = mapped_column(String(16))
    change_pct_low: Mapped[float | None] = mapped_column(Float)
    change_pct_high: Mapped[float | None] = mapped_column(Float)
    net_profit_low: Mapped[float | None] = mapped_column(Float)
    net_profit_high: Mapped[float | None] = mapped_column(Float)

    last_period_net_profit: Mapped[float | None] = mapped_column(Float)
    summary: Mapped[str | None] = mapped_column(String(500))
    reason: Mapped[str | None] = mapped_column(String(500))

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
