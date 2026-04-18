from sqlalchemy import String, Date, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, datetime
from app.database import Base


class DailySnapshot(Base):
    """预聚合快照——前端直接消费的成品 JSON"""
    __tablename__ = "daily_snapshots"
    __table_args__ = (
        UniqueConstraint("trade_date", "snapshot_type", name="uq_snapshot"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    snapshot_type: Mapped[str] = mapped_column(String(30))
    # snapshot_type 取值:
    #   overview        - 概览指标(涨停数/跌停数/炸板率/最高板等)
    #   ladder          - 梯队视图(按高度分层的股票列表)
    #   theme_heatmap   - 题材热力图
    #   industry_rank   - 行业排名
    #   strong_stocks   - 强势股排名
    #   sentiment_curve - 情绪曲线(追加到时间序列)
    data: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now, onupdate=datetime.now)


class DataUpdateLog(Base):
    """数据管线运行日志"""
    __tablename__ = "data_update_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    step: Mapped[str] = mapped_column(String(30))  # collect / clean / compute / aggregate
    status: Mapped[str] = mapped_column(String(20))  # running / success / failed
    started_at: Mapped[datetime] = mapped_column(default=datetime.now)
    finished_at: Mapped[datetime | None] = mapped_column()
    error_message: Mapped[str | None] = mapped_column(Text)
    records_count: Mapped[int] = mapped_column(Integer, default=0)
