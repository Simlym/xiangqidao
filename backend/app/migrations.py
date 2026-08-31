"""Alembic 运行入口，以及旧数据库首次接管逻辑。"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from .database import Base, _bootstrap_legacy_database, engine


BACKEND_DIR = Path(__file__).resolve().parents[1]
BASELINE_REVISION = "202608310001"


def _config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    # 使用绝对路径，确保从项目根目录或 backend 目录启动都能找到迁移脚本。
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return config


def upgrade_database() -> None:
    """接管旧库并升级到最新版本；空库则由基线迁移完整建表。"""
    tables = set(inspect(engine).get_table_names())
    application_tables = tables.intersection(Base.metadata.tables)

    if application_tables and "alembic_version" not in tables:
        _bootstrap_legacy_database()
        command.stamp(_config(), BASELINE_REVISION)

    command.upgrade(_config(), "head")
