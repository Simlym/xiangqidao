"""收敛旧手写迁移遗留的可空列与缺失索引。

Revision ID: 202608310003
Revises: 202608310002
Create Date: 2026-08-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision = "202608310003"
down_revision = "202608310002"
branch_labels = None
depends_on = None


_NOT_NULL_COLUMNS: dict[str, Sequence[tuple[str, sa.types.TypeEngine, object]]] = {
    "attempts": (("context", sa.String(length=80), "training"),),
    "games": (
        ("variant", sa.String(length=12), "xiangqi"),
        ("initial_fen", sa.Text(), ""),
        ("positions_json", sa.Text(), ""),
    ),
    "puzzles": (
        ("variant", sa.String(length=12), "xiangqi"),
        ("kind", sa.String(length=10), "杀法"),
        ("steps", sa.Integer(), 1),
        ("ai_explanation", sa.Text(), ""),
        ("tags", sa.Text(), ""),
    ),
    "users": (("plan", sa.String(length=12), "free"),),
}

_INDEXES = {
    "attempts": (("ix_attempts_context", ("context",)),),
    "games": (("ix_games_variant", ("variant",)),),
    "puzzles": (
        ("ix_puzzles_kind", ("kind",)),
        ("ix_puzzles_variant", ("variant",)),
    ),
}


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)

    for table_name, specifications in _NOT_NULL_COLUMNS.items():
        columns = {column["name"]: column for column in inspector.get_columns(table_name)}
        pending = [spec for spec in specifications if columns[spec[0]]["nullable"]]
        if not pending:
            continue

        table = sa.table(table_name, *(sa.column(name, type_) for name, type_, _ in pending))
        for name, _, default in pending:
            column = table.c[name]
            op.execute(table.update().where(column.is_(None)).values({name: default}))

        # SQLite 通过 batch 模式重建表；其他数据库会生成普通 ALTER COLUMN。
        with op.batch_alter_table(table_name) as batch_op:
            for name, type_, _ in pending:
                batch_op.alter_column(name, existing_type=type_, nullable=False)

    inspector = sa.inspect(connection)
    for table_name, indexes in _INDEXES.items():
        existing = {index["name"] for index in inspector.get_indexes(table_name)}
        for index_name, columns in indexes:
            if index_name not in existing:
                op.create_index(index_name, table_name, list(columns), unique=False)


def downgrade() -> None:
    # 本 revision 仅把旧库收敛到基线本就声明的结构，不改变基线语义。
    pass
