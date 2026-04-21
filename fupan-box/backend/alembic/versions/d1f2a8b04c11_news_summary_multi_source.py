"""news_summary multi-source schema

Revision ID: d1f2a8b04c11
Revises: c8a37f2b91d4
Create Date: 2026-04-21 18:00:00.000000

Phase 1 of news module overhaul. Extends news_summaries with:
- title_hash (SimHash 16-hex, dedupe key)
- pub_time (precise datetime)
- source_urls (cross-source merged urls)
- raw_tags (source-provided tags)
- importance / sentiment / tags / ai_tagged_at (AI tagging metadata)
- embedding_status (Phase 4 RAG placeholder)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d1f2a8b04c11"
down_revision: Union[str, Sequence[str], None] = "c8a37f2b91d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 新列
    op.add_column(
        "news_summaries",
        sa.Column("title_hash", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "news_summaries",
        sa.Column("pub_time", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "news_summaries",
        sa.Column(
            "source_urls",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "news_summaries",
        sa.Column(
            "raw_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "news_summaries",
        sa.Column(
            "importance",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("2"),
        ),
    )
    op.add_column(
        "news_summaries",
        sa.Column("sentiment", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "news_summaries",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "news_summaries",
        sa.Column("ai_tagged_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "news_summaries",
        sa.Column("embedding_status", sa.String(length=20), nullable=True),
    )

    # source / source_url 现有列扩长度
    op.alter_column(
        "news_summaries",
        "source_url",
        existing_type=sa.String(length=500),
        type_=sa.String(length=800),
        existing_nullable=True,
    )

    # 索引
    op.create_index("ix_news_summaries_title_hash", "news_summaries", ["title_hash"], unique=False)
    op.create_index("ix_news_pub_time", "news_summaries", ["pub_time"], unique=False)
    op.create_index("ix_news_publish_date", "news_summaries", ["publish_date"], unique=False)
    op.create_index(
        "ix_news_importance_pub_time",
        "news_summaries",
        ["importance", "pub_time"],
        unique=False,
    )
    op.create_index("ix_news_summaries_source", "news_summaries", ["source"], unique=False)
    op.create_index("ix_news_summaries_importance", "news_summaries", ["importance"], unique=False)

    # 唯一约束 (允许 NULL — 老数据 title_hash 是 NULL 不冲突)
    op.create_unique_constraint("uq_news_title_hash", "news_summaries", ["title_hash"])


def downgrade() -> None:
    op.drop_constraint("uq_news_title_hash", "news_summaries", type_="unique")
    op.drop_index("ix_news_summaries_importance", table_name="news_summaries")
    op.drop_index("ix_news_summaries_source", table_name="news_summaries")
    op.drop_index("ix_news_importance_pub_time", table_name="news_summaries")
    op.drop_index("ix_news_publish_date", table_name="news_summaries")
    op.drop_index("ix_news_pub_time", table_name="news_summaries")
    op.drop_index("ix_news_summaries_title_hash", table_name="news_summaries")

    op.alter_column(
        "news_summaries",
        "source_url",
        existing_type=sa.String(length=800),
        type_=sa.String(length=500),
        existing_nullable=True,
    )

    op.drop_column("news_summaries", "embedding_status")
    op.drop_column("news_summaries", "ai_tagged_at")
    op.drop_column("news_summaries", "tags")
    op.drop_column("news_summaries", "sentiment")
    op.drop_column("news_summaries", "importance")
    op.drop_column("news_summaries", "raw_tags")
    op.drop_column("news_summaries", "source_urls")
    op.drop_column("news_summaries", "pub_time")
    op.drop_column("news_summaries", "title_hash")
