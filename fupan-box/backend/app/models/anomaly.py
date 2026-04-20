"""盘中异动表.

anomaly_type 枚举:
    surge       : 5min 涨幅 >= 3% 急拉
    plunge      : 5min 跌幅 >= 3% 闪崩
    break       : 涨停打开 (封板后炸板)
    seal        : 反包封板 (跌停反封 / 反复封板)
    theme_burst : 板块整体涨幅 >= 2% 集体异动 (key=theme_name)
"""
from datetime import date as date_type, datetime
from sqlalchemy import String, Integer, Float, Text, Date, DateTime, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class IntradayAnomaly(Base):
    __tablename__ = "intraday_anomalies"
    __table_args__ = (
        Index("ix_anomaly_date_type", "trade_date", "anomaly_type"),
        Index("ix_anomaly_detected_at", "detected_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date_type] = mapped_column(Date, index=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    anomaly_type: Mapped[str] = mapped_column(String(20))
    code: Mapped[str | None] = mapped_column(String(20), index=True)  # 个股 6 位 / theme 时为 None
    name: Mapped[str | None] = mapped_column(String(50))
    theme: Mapped[str | None] = mapped_column(String(80))
    price: Mapped[float | None] = mapped_column(Float)
    change_pct: Mapped[float | None] = mapped_column(Float)
    delta_5m_pct: Mapped[float | None] = mapped_column(Float)  # 5min 内涨幅变化
    volume_yi: Mapped[float | None] = mapped_column(Float)
    severity: Mapped[int] = mapped_column(Integer, default=1)  # 1-5 重要性
    ai_brief: Mapped[str | None] = mapped_column(Text)
    seen: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
