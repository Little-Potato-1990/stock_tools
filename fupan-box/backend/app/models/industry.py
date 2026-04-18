from sqlalchemy import String, Integer, Numeric, ForeignKey, UniqueConstraint, Date
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date
from app.database import Base


class Industry(Base):
    """行业分类"""
    __tablename__ = "industries"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(20), default="sw")  # sw(申万) / custom
    level: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("industries.id"))


class IndustryStock(Base):
    """行业成分股"""
    __tablename__ = "industry_stocks"
    __table_args__ = (
        UniqueConstraint("industry_id", "stock_code", name="uq_industry_stock"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id"), index=True)
    stock_code: Mapped[str] = mapped_column(String(10), index=True)


class IndustryDaily(Base):
    """行业每日数据"""
    __tablename__ = "industry_daily"
    __table_args__ = (
        UniqueConstraint("industry_id", "trade_date", name="uq_industry_daily"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id"), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    up_count: Mapped[int] = mapped_column(Integer, default=0)
    limit_up_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_change_pct: Mapped[float] = mapped_column(Numeric(8, 4), default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    strong_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_strength: Mapped[float] = mapped_column(Numeric(8, 4), default=0)
    rank: Mapped[int | None] = mapped_column(Integer)
