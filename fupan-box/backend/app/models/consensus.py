"""卖方一致预期数据模型——周维度聚合.

数据来源: tushare pro.report_rc (2000 积分).
按 (week_end, stock_code) 唯一. ETL 每周一 18:00 跑一次.

字段:
- target_price_*: 目标价分布 (avg/median/min/max)
- eps_fy1/fy2/fy3: 当年/下一年/再下一年 EPS 一致预期
- rating_*: 各等级研报数 (buy/outperform/hold/underperform/sell)
- target_price_chg_4w_pct: 目标价 4 周变化(上修/下修信号)
"""
from datetime import date as date_type, datetime
from sqlalchemy import String, Float, Integer, Date, DateTime, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AnalystConsensusWeekly(Base):
    """周频卖方一致预期——给一致预期 Tab + 长线 brief 用."""
    __tablename__ = "analyst_consensus_weekly"
    __table_args__ = (
        UniqueConstraint("week_end", "stock_code", name="uq_consensus_weekly"),
        Index("ix_consensus_stock_week", "stock_code", "week_end"),
        Index("ix_consensus_week_chg", "week_end", "target_price_chg_4w_pct"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    week_end: Mapped[date_type] = mapped_column(Date, index=True)
    stock_code: Mapped[str] = mapped_column(String(10))

    target_price_avg: Mapped[float | None] = mapped_column(Float)
    target_price_median: Mapped[float | None] = mapped_column(Float)
    target_price_min: Mapped[float | None] = mapped_column(Float)
    target_price_max: Mapped[float | None] = mapped_column(Float)
    target_price_chg_4w_pct: Mapped[float | None] = mapped_column(Float)

    eps_fy1: Mapped[float | None] = mapped_column(Float)
    eps_fy2: Mapped[float | None] = mapped_column(Float)
    eps_fy3: Mapped[float | None] = mapped_column(Float)
    eps_fy1_chg_4w_pct: Mapped[float | None] = mapped_column(Float)

    rating_buy: Mapped[int | None] = mapped_column(Integer)
    rating_outperform: Mapped[int | None] = mapped_column(Integer)
    rating_hold: Mapped[int | None] = mapped_column(Integer)
    rating_underperform: Mapped[int | None] = mapped_column(Integer)
    rating_sell: Mapped[int | None] = mapped_column(Integer)

    report_count: Mapped[int | None] = mapped_column(Integer)
    institution_count: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
