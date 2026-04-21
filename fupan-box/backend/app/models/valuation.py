"""估值数据模型——日频 PE/PB/PS + 5 年滚动分位.

数据来源: tushare pro.daily_basic 全字段 (2000 积分).
现有 tushare_adapter 仅取 turnover_rate, 这里独立扩展取全部估值字段.

5 年分位 (pe_pct_5y / pb_pct_5y) 由 ETL 计算后落库, 避免查询时实时算.
窗口: 过去 5 年同股票 (约 1200 个交易日) 的 PE/PB 分位排名.
"""
from datetime import date as date_type, datetime
from sqlalchemy import String, Float, Date, DateTime, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class StockValuationDaily(Base):
    """单股单日估值快照——给中长视角估值分位 Tab + 长线 brief 用."""
    __tablename__ = "stock_valuation_daily"
    __table_args__ = (
        UniqueConstraint("trade_date", "stock_code", name="uq_valuation_daily"),
        Index("ix_val_stock_date", "stock_code", "trade_date"),
        Index("ix_val_date_pe", "trade_date", "pe_ttm"),
        Index("ix_val_date_pb_pct", "trade_date", "pb_pct_5y"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date_type] = mapped_column(Date, index=True)
    stock_code: Mapped[str] = mapped_column(String(10))

    pe: Mapped[float | None] = mapped_column(Float)
    pe_ttm: Mapped[float | None] = mapped_column(Float)
    pb: Mapped[float | None] = mapped_column(Float)
    ps: Mapped[float | None] = mapped_column(Float)
    ps_ttm: Mapped[float | None] = mapped_column(Float)
    dv_ratio: Mapped[float | None] = mapped_column(Float)
    dv_ttm: Mapped[float | None] = mapped_column(Float)

    total_share: Mapped[float | None] = mapped_column(Float)
    float_share: Mapped[float | None] = mapped_column(Float)
    free_share: Mapped[float | None] = mapped_column(Float)
    total_mv: Mapped[float | None] = mapped_column(Float)
    circ_mv: Mapped[float | None] = mapped_column(Float)

    pe_pct_5y: Mapped[float | None] = mapped_column(Float)
    pb_pct_5y: Mapped[float | None] = mapped_column(Float)
    pe_pct_3y: Mapped[float | None] = mapped_column(Float)
    pb_pct_3y: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
