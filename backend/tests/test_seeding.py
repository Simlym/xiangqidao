"""启动播种测试：空库自动导入种子题库，重复启动幂等，坏文件不阻断。"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.models import Base, Puzzle
from app.modules.puzzles import seeding

# 双车错一步杀：h7f7 与 h1f1 均成立
MATE_FEN = "9/9/5k1R1/9/9/9/9/9/7R1/4K4 w"
PUZZLE = {"fen": MATE_FEN, "solution": "h7f7", "category": "双车错", "difficulty": 3}


def _session_factory():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)


def _count(factory) -> int:
    with factory() as db:
        return db.scalar(select(func.count()).select_from(Puzzle))


def test_seeds_empty_library_once(tmp_path, monkeypatch):
    (tmp_path / "a.json").write_text(json.dumps([PUZZLE]), encoding="utf-8")
    (tmp_path / "b.json").write_text("坏 JSON", encoding="utf-8")
    factory = _session_factory()
    monkeypatch.setattr(seeding, "SessionLocal", factory)
    monkeypatch.setattr(seeding, "seeds_dir", lambda: tmp_path)

    seeding.seed_default_library()
    assert _count(factory) == 1  # 坏文件被跳过，好文件导入

    # 幂等：已有公共题库后再次启动不再导入
    seeding.seed_default_library()
    assert _count(factory) == 1


def test_skips_when_no_seeds_dir(tmp_path, monkeypatch):
    factory = _session_factory()
    monkeypatch.setattr(seeding, "SessionLocal", factory)
    monkeypatch.setattr(seeding, "seeds_dir", lambda: tmp_path / "不存在")

    seeding.seed_default_library()  # 目录缺失：静默跳过，不抛错
    assert _count(factory) == 0
