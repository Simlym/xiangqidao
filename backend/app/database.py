"""持久化层配置：引擎、会话、建表与轻量迁移，与模型定义解耦。

DB 连接串通过环境变量 XQ_DB_URL 配置，默认沿用本地 sqlite，便于在
不同环境（测试/生产/其他数据库）切换而无需改动模型与业务代码。
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DB_URL = os.environ.get("XQ_DB_URL", "sqlite:///./data/puzzles.db")

# sqlite 本地文件库：自动创建父目录，避免首次运行报 "unable to open database file"
_url = make_url(DB_URL)
if _url.drivername.startswith("sqlite") and _url.database and _url.database != ":memory:":
    _parent = os.path.dirname(_url.database)
    if _parent:
        os.makedirs(_parent, exist_ok=True)

# sqlite 需要 check_same_thread=False 以配合多线程（后台分析任务）
_connect_args = {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
engine = create_engine(DB_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    pass


def _ensure_columns() -> None:
    """为既有 SQLite 库补齐新增列（本项目暂无迁移框架，做最小兼容）。"""
    if not DB_URL.startswith("sqlite"):
        return
    insp = inspect(engine)
    additions = {
        "reviews": [("created_at", "DATE")],
        "attempts": [("had_retry", "BOOLEAN DEFAULT 0")],
        "puzzles": [
            ("user_id", "VARCHAR(40) DEFAULT 'default'"),
            ("rating", "INTEGER"),
            ("kind", "VARCHAR(10) DEFAULT '杀法'"),
            ("steps", "INTEGER DEFAULT 1"),
            ("ai_explanation", "TEXT DEFAULT ''"),
        ],
        "games": [
            ("user_id", "VARCHAR(40) DEFAULT 'default'"),
            ("report", "TEXT DEFAULT ''"),
        ],
        "coach_plans": [
            ("progress_json", "TEXT DEFAULT ''"),
        ],
    }
    with engine.begin() as conn:
        added: set[str] = set()
        for table, cols in additions.items():
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                    added.add(f"{table}.{name}")
        # 新增题目评分列：按难度回填初始 ELO（公式与 elo.difficulty_to_rating 一致）
        if "puzzles.rating" in added:
            conn.execute(
                text("UPDATE puzzles SET rating = 550 + 250 * difficulty WHERE rating IS NULL")
            )
        # 新增 steps 列：按题解着法数回填（己方着法数 = (总手数+1)//2），缺省按难度近似
        if "puzzles.steps" in added:
            conn.execute(
                text(
                    "UPDATE puzzles SET steps = "
                    "(LENGTH(solution) - LENGTH(REPLACE(solution, ',', '')) + 2) / 2 "
                    "WHERE steps IS NULL OR steps < 1"
                )
            )


def _migrate_reviews_unique() -> None:
    """旧库 reviews.puzzle_id 为单列 UNIQUE，多用户对同一题各自建复习记录会冲突；
    重建表迁移为 (puzzle_id, user_id) 联合唯一。SQLite 无法删除列内联约束，只能重建。"""
    if not DB_URL.startswith("sqlite"):
        return
    with engine.begin() as conn:
        indexes = conn.execute(text("PRAGMA index_list('reviews')")).fetchall()
        # 行结构: (seq, name, unique, origin, partial)
        needs_rebuild = False
        for _, name, unique, *_ in indexes:
            if not unique:
                continue
            cols = [r[2] for r in conn.execute(text(f"PRAGMA index_info('{name}')"))]
            if cols == ["puzzle_id"]:
                needs_rebuild = True
                break
        if not needs_rebuild:
            return
        # 先删命名索引（重命名表不改索引名，否则与新表索引冲突）；自动索引随表删除
        for _, name, *_ in indexes:
            if not name.startswith("sqlite_autoindex"):
                conn.execute(text(f"DROP INDEX {name}"))
        conn.execute(text("ALTER TABLE reviews RENAME TO reviews_old"))
        Base.metadata.tables["reviews"].create(bind=conn)
        cols_sql = "id, puzzle_id, user_id, repetitions, interval, ease_factor, next_review, created_at"
        conn.execute(
            text(f"INSERT INTO reviews ({cols_sql}) SELECT {cols_sql} FROM reviews_old")
        )
        conn.execute(text("DROP TABLE reviews_old"))


def init_db() -> None:
    # 导入 models 以确保所有表都已注册到 Base.metadata
    from . import models  # noqa: F401

    Base.metadata.create_all(engine)
    _ensure_columns()
    _migrate_reviews_unique()


@contextmanager
def session_scope():
    """事务性会话上下文：正常提交、异常回滚、最终关闭。"""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
