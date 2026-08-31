"""当前完整数据库结构基线。

Revision ID: 202608310001
Revises:
Create Date: 2026-08-31
"""

from alembic import op

from app.database import Base
from app import models  # noqa: F401


revision = "202608310001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 只用于空库；已有业务表的旧库会在应用启动时整理结构并 stamp 此基线。
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
