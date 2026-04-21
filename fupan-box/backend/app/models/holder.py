"""季报股东 + 主力身份注册.

HolderSnapshotQuarterly 来自 akshare 季报披露的"前十大股东"和"前十大流通股东".
HolderIdentityRegistry 维护汇金/社保/险资/QFII/明星公募的标准化名 + 别名 + 影响力权重.

身份匹配由 services/holder_matcher.py 完成: 入库前对 holder_name 跑一次 fuzzy 匹配,
把 canonical_name / holder_type / fund_company 落到 HolderSnapshotQuarterly 上.
"""
from datetime import date as date_type, datetime
from sqlalchemy import String, Float, Date, DateTime, Boolean, Integer, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class HolderSnapshotQuarterly(Base):
    """季报股东快照——按 (stock_code, report_date, holder_name) 唯一."""
    __tablename__ = "holder_snapshot_quarterly"
    __table_args__ = (
        UniqueConstraint(
            "stock_code", "report_date", "holder_name", "is_free_float",
            name="uq_holder_snapshot",
        ),
        Index("ix_hs_stock_report", "stock_code", "report_date"),
        Index("ix_hs_canonical", "canonical_name", "report_date"),
        Index("ix_hs_type", "holder_type", "report_date"),
        Index("ix_hs_change", "report_date", "change_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    report_date: Mapped[date_type] = mapped_column(Date, index=True)
    stock_code: Mapped[str] = mapped_column(String(10))
    stock_name: Mapped[str | None] = mapped_column(String(50))
    holder_name: Mapped[str] = mapped_column(String(200))
    canonical_name: Mapped[str | None] = mapped_column(String(80))
    holder_type: Mapped[str] = mapped_column(String(20), default="other")
    # holder_type: sovereign | social | insurance | fund | qfii | exec | central_soe | other
    fund_company: Mapped[str | None] = mapped_column(String(80))
    is_free_float: Mapped[bool] = mapped_column(Boolean, default=False)
    rank: Mapped[int | None] = mapped_column(Integer)
    shares: Mapped[float | None] = mapped_column(Float)
    shares_pct: Mapped[float | None] = mapped_column(Float)
    change_shares: Mapped[float | None] = mapped_column(Float)
    change_pct: Mapped[float | None] = mapped_column(Float)
    change_type: Mapped[str | None] = mapped_column(String(12))
    # change_type: new / add / cut / exit / unchanged
    weight: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class HolderIdentityRegistry(Base):
    """主力身份注册表——把"中央汇金资产管理有限责任公司" 标准化为 "中央汇金"."""
    __tablename__ = "holder_identity_registry"
    __table_args__ = (
        UniqueConstraint("canonical_name", name="uq_holder_canonical"),
        Index("ix_hir_type", "holder_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    canonical_name: Mapped[str] = mapped_column(String(80))
    holder_type: Mapped[str] = mapped_column(String(20))
    fund_company: Mapped[str | None] = mapped_column(String(80))
    aliases: Mapped[list[str]] = mapped_column(JSONB, default=list)
    weight: Mapped[int] = mapped_column(Integer, default=5)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
