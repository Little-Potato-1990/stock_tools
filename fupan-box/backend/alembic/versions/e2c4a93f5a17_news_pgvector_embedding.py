"""news embedding via pgvector

Revision ID: e2c4a93f5a17
Revises: d1f2a8b04c11
Create Date: 2026-04-21 19:30:00.000000

Phase 4 (RAG):
- 启用 pgvector extension
- news_summaries 增 embedding (vector(N)) + embedding_model + embedded_at
- 给 embedding_status 加索引 (worker 拉 pending 用)
- 给 embedding 建 ivfflat 索引 (cosine ops, lists=100)

注意:
1) embedding 维度 (默认 1536) 与 settings.news_embedding_dim 必须一致.
   如果用户改了维度, 需要先 DROP COLUMN 再以新维度重建.
2) ivfflat lists 推荐 = sqrt(rows). 数据量到 1w+ 后可以 REINDEX 调到 200-400.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2c4a93f5a17"
down_revision: Union[str, Sequence[str], None] = "d1f2a8b04c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 与 app.config.Settings.news_embedding_dim 默认值保持一致
EMBED_DIM = 1536


def upgrade() -> None:
    # 1. 启用 vector extension (幂等)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # 2. 新列
    op.add_column(
        "news_summaries",
        sa.Column("embedding_model", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "news_summaries",
        sa.Column("embedded_at", sa.DateTime(), nullable=True),
    )
    op.execute(
        f"ALTER TABLE news_summaries ADD COLUMN IF NOT EXISTS embedding vector({EMBED_DIM})"
    )

    # 3. 索引
    op.create_index(
        "ix_news_embedding_status",
        "news_summaries",
        ["embedding_status"],
        unique=False,
    )

    # ivfflat: cosine 距离索引. 对未填充的 NULL 行直接跳过.
    # 仅当表已有数据 ≥ lists*40 时, ANALYZE 后效果最佳; 这里默认 lists=100, 适合 4k+ 行.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_news_embedding_ivfflat "
        "ON news_summaries USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_news_embedding_ivfflat")
    op.drop_index("ix_news_embedding_status", table_name="news_summaries")
    op.drop_column("news_summaries", "embedding")
    op.drop_column("news_summaries", "embedded_at")
    op.drop_column("news_summaries", "embedding_model")
    # 不 DROP EXTENSION vector — 其他表/索引可能依赖
