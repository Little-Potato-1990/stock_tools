from sqlalchemy import String, Date, Integer, Float, Text, ForeignKey, Column, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, datetime
from app.database import Base


class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    trade_date: Mapped[date | None] = mapped_column(Date)
    title: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now, onupdate=datetime.now)


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ai_conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user / assistant / system
    content: Mapped[str] = mapped_column(Text)
    references: Mapped[dict | None] = mapped_column(JSONB)
    tool_calls: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class NewsSummary(Base):
    """新闻/公告摘要——供 RAG 检索。embedding 列待 pgvector 扩展就绪后启用。"""
    __tablename__ = "news_summaries"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    summary: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(50))
    source_url: Mapped[str | None] = mapped_column(String(500))
    publish_date: Mapped[date] = mapped_column(Date, index=True)
    related_stocks: Mapped[dict | None] = mapped_column(JSONB)
    related_themes: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class AIBriefFeedback(Base):
    """用户对 5 张 AI 卡片 / 主 brief 的反馈 — P3-C 反馈闭环.

    rating: 1 = 👍, -1 = 👎 (前端默认只暴露这两态)
    evidence_correct: True/False/None — 用户对 evidence 真实性的标注 (None = 没标)
    snapshot: 反馈瞬间的卡片快照 (headline + evidence 等), 便于复盘看用户在评什么
    """

    __tablename__ = "ai_brief_feedback"
    __table_args__ = (
        Index("ix_ai_fb_kind_date", "brief_kind", "trade_date"),
        Index("ix_ai_fb_user", "user_id"),
        # FeedbackStatsPanel 默认 days=30, 按 created_at >= now()-N days 过滤,
        # 不加索引会全表扫描.
        Index("ix_ai_fb_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    brief_kind: Mapped[str] = mapped_column(String(30), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    model: Mapped[str | None] = mapped_column(String(50))
    rating: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(Text)
    evidence_correct: Mapped[bool | None] = mapped_column()
    snapshot: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)


class AIPrediction(Base):
    """AI 预测落库 — 用于 T+N 后回溯命中率, 形成自我进化闭环.

    kind 枚举:
        regime          : 大盘势的判断 (consensus/climax/diverge/repair)
        tilt            : 相似日 AI 综合判断 (延续/反转/震荡)
        promotion       : 晋级候选 (key=stock_code)
        first_board     : 首板候选 (key=stock_code)
        avoid           : 风险规避 (key=stock_code)

    payload 存预测的完整内容; verify_payload 存校验时的实际数据.
    score: -1 ~ 1 分, hit: True/False/None (None=尚未校验).
    """
    __tablename__ = "ai_predictions"
    __table_args__ = (
        UniqueConstraint("trade_date", "kind", "key", name="uq_ai_pred"),
        Index("ix_ai_pred_kind_date", "kind", "trade_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    model: Mapped[str] = mapped_column(String(50))
    kind: Mapped[str] = mapped_column(String(20))
    key: Mapped[str] = mapped_column(String(80), default="_")
    payload: Mapped[dict] = mapped_column(JSONB)
    verify_payload: Mapped[dict | None] = mapped_column(JSONB)
    hit: Mapped[bool | None] = mapped_column()
    score: Mapped[float | None] = mapped_column(Float)
    verified_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=datetime.now)
