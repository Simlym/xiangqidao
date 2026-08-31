"""为用户表添加最近登录时间。

Revision ID: 202608310002
Revises: 202608310001
Create Date: 2026-08-31
"""

import sqlalchemy as sa
from alembic import op


revision = "202608310002"
down_revision = "202608310001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "last_login" not in columns:
        op.add_column("users", sa.Column("last_login", sa.DateTime(), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "last_login" in columns:
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("last_login")
