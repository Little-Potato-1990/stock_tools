"""AI brief 跨进程持久缓存.

用途: 替代之前的纯内存 TTL cache, 让 backend 重启不丢, 且支持 celery 预热.

cache_key 约定 (各调用方自行拼装, 字符串):
    why_rose:{code}:{trade_date}:{model}
    debate:{topic_type}:{topic_key}:{trade_date}:{model}
    market_brief:{trade_date}:{model}
    ladder_brief:{trade_date}:{model}
    sentiment_brief:{trade_date}:{model}
    theme_brief:{trade_date}:{model}
    anomaly_brief:{anom_id}:{model}

content 是 JSON dict 序列化, 按 fn 实际返回结构.
"""
from datetime import date as date_type, datetime
from sqlalchemy import String, Integer, Date, DateTime, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AIBriefCache(Base):
    __tablename__ = "ai_brief_cache"
    __table_args__ = (
        Index("ix_aicache_key", "cache_key", unique=True),
        Index("ix_aicache_action_date", "action", "trade_date"),
        Index("ix_aicache_expires", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(40))  # why_rose / debate / market_brief / ...
    model: Mapped[str | None] = mapped_column(String(40))
    trade_date: Mapped[date_type | None] = mapped_column(Date)
    content: Mapped[dict] = mapped_column(JSON)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(20), default="ondemand")  # ondemand / prewarm
