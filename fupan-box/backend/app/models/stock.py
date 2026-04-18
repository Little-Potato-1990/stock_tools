from sqlalchemy import String, Date, Numeric, BigInteger, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, datetime
from app.database import Base


class Stock(Base):
    """股票主数据"""
    __tablename__ = "stocks"

    code: Mapped[str] = mapped_column(String(10), primary_key=True)
    name: Mapped[str] = mapped_column(String(20), index=True)
    market: Mapped[str] = mapped_column(String(5))  # SH / SZ / BJ
    list_date: Mapped[date | None] = mapped_column(Date)
    is_st: Mapped[bool] = mapped_column(Boolean, default=False)
    industry: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now, onupdate=datetime.now)


class DailyQuote(Base):
    """日K线行情"""
    __tablename__ = "daily_quotes"
    __table_args__ = (
        UniqueConstraint("stock_code", "trade_date", name="uq_daily_quotes"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_code: Mapped[str] = mapped_column(String(10), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    open: Mapped[float] = mapped_column(Numeric(10, 2))
    high: Mapped[float] = mapped_column(Numeric(10, 2))
    low: Mapped[float] = mapped_column(Numeric(10, 2))
    close: Mapped[float] = mapped_column(Numeric(10, 2))
    pre_close: Mapped[float] = mapped_column(Numeric(10, 2))
    change_pct: Mapped[float] = mapped_column(Numeric(8, 4))
    volume: Mapped[int] = mapped_column(BigInteger)
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    turnover_rate: Mapped[float | None] = mapped_column(Numeric(8, 4))
    amplitude: Mapped[float | None] = mapped_column(Numeric(8, 4))
    is_limit_up: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_limit_down: Mapped[bool] = mapped_column(Boolean, default=False)
