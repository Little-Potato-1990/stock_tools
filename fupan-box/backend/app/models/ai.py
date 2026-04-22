from sqlalchemy import String, Date, DateTime, Integer, Float, Text, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, datetime
from app.database import Base

try:
    from pgvector.sqlalchemy import Vector  # type: ignore
    _HAS_PGVECTOR = True
except ImportError:  # pragma: no cover - pgvector 是 hard dep, 但允许 dev 环境降级
    _HAS_PGVECTOR = False
    Vector = None  # type: ignore

from app.config import get_settings  # noqa: E402

_EMBED_DIM = get_settings().news_embedding_dim


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
    """多源新闻 / 公告 / 政策快讯持久层 — Phase 1 新增字段.

    去重策略: title_hash 取 SimHash 16-hex (cf. app.news.ingest.dedupe).
    同一条新闻被多个 source 同时报时, 选最早的入库, 把其他 source 信息合并到 source_urls.
    """
    __tablename__ = "news_summaries"
    __table_args__ = (
        Index("ix_news_pub_time", "pub_time"),
        Index("ix_news_publish_date", "publish_date"),
        Index("ix_news_importance_pub_time", "importance", "pub_time"),
        UniqueConstraint("title_hash", name="uq_news_title_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    title_hash: Mapped[str] = mapped_column(String(20), index=True)  # 去重 key (SimHash hex)
    summary: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(50), index=True)
    source_url: Mapped[str | None] = mapped_column(String(800))
    source_urls: Mapped[dict | None] = mapped_column(JSONB)        # {source: url} 跨源合并
    publish_date: Mapped[date] = mapped_column(Date, index=True)
    pub_time: Mapped[datetime | None] = mapped_column(DateTime)    # 精确到秒, 主时间字段
    related_stocks: Mapped[dict | None] = mapped_column(JSONB)     # ["600519", ...]
    related_themes: Mapped[dict | None] = mapped_column(JSONB)     # ["AI", ...]
    raw_tags: Mapped[dict | None] = mapped_column(JSONB)           # source 自带标签

    # AI 打标 (Phase 1 同步写入, 失败用 heuristic)
    importance: Mapped[int] = mapped_column(Integer, default=2, index=True)  # 1-5
    sentiment: Mapped[str | None] = mapped_column(String(10))      # bullish/neutral/bearish
    tags: Mapped[dict | None] = mapped_column(JSONB)               # 简短标签 ["利好","政策"]
    # Phase 2: 影响时间维度, 给中长视角新闻过滤用
    # short  = 今日/本周盘面催化 (涨停/异动/快讯)
    # swing  = 5-20 日波段 (订单/中标/业绩/重组)
    # long   = 长线逻辑 (战略/研发/产能扩张/政策周期)
    # mixed  = 同时影响多个时间维度 (重大并购/行业政策)
    impact_horizon: Mapped[str | None] = mapped_column(String(8), index=True)
    ai_tagged_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Phase 5: 海外事件 → A 股映射链 (global-signals skill 借鉴)
    # {
    #   "overseas_event": "NVIDIA Q4 业绩超预期",
    #   "transmission": "算力需求上修 → 光模块订单确认 → 国产算力链受益",
    #   "beneficiary_codes": ["002475", "300502"],
    #   "confidence": "high" | "medium" | "low"
    # }
    global_mapping: Mapped[dict | None] = mapped_column(JSONB)

    # Phase 4 RAG: pgvector 向量 + 状态机
    embedding_status: Mapped[str | None] = mapped_column(String(20), index=True)  # null|pending|done|failed
    embedding_model: Mapped[str | None] = mapped_column(String(50))
    embedded_at: Mapped[datetime | None] = mapped_column(DateTime)
    if _HAS_PGVECTOR:
        embedding: Mapped[list[float] | None] = mapped_column(Vector(_EMBED_DIM), nullable=True)  # type: ignore[arg-type]

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
