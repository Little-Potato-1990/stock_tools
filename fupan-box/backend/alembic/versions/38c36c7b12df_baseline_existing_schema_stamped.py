"""baseline (existing schema, stamped)

这是 alembic 接管之前已经存在的 schema, 通过 ``alembic stamp 38c36c7b12df``
把已有数据库标记为该版本即可, 不需要执行 DDL.

全新部署时, 可以用 ``Base.metadata.create_all`` 先建表, 再 ``stamp`` 到这个
版本, 或者把后续真正的 DDL 都补成下游 revision.

Revision ID: 38c36c7b12df
Revises:
Create Date: 2026-04-21 04:25:01.011348

"""
from typing import Sequence, Union


revision: str = "38c36c7b12df"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: 现有 schema 由历史脚本/Base.metadata.create_all 创建."""


def downgrade() -> None:
    """No-op: 不支持降到 baseline 之前."""
