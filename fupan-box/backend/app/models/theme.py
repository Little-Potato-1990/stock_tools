from sqlalchemy import String, Date, Integer, Numeric, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, datetime
from app.database import Base


class Theme(Base):
    """题材/概念"""
    __tablename__ = "themes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("themes.id"))
    source: Mapped[str] = mapped_column(String(20), default="eastmoney")  # eastmoney / custom
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class ThemeStock(Base):
    """题材成分股"""
    __tablename__ = "theme_stocks"
    __table_args__ = (
        UniqueConstraint("theme_id", "stock_code", name="uq_theme_stock"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    theme_id: Mapped[int] = mapped_column(ForeignKey("themes.id"), index=True)
    stock_code: Mapped[str] = mapped_column(String(10), index=True)
    added_date: Mapped[date | None] = mapped_column(Date)


class ThemeDaily(Base):
    """题材每日活跃度"""
    __tablename__ = "theme_daily"
    __table_args__ = (
        UniqueConstraint("theme_id", "trade_date", name="uq_theme_daily"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    theme_id: Mapped[int] = mapped_column(ForeignKey("themes.id"), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    up_count: Mapped[int] = mapped_column(Integer, default=0)
    limit_up_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_change_pct: Mapped[float] = mapped_column(Numeric(8, 4), default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    rank: Mapped[int | None] = mapped_column(Integer)
    is_continuous: Mapped[bool] = mapped_column(Boolean, default=False)  # 持续上榜
    continuous_days: Mapped[int] = mapped_column(Integer, default=0)
