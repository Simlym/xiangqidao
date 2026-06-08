"""新增闭环功能测试：棋局按用户隔离、题目可见性、按类目/按 id 取题。"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import repository as repo
from app.models import Base, Puzzle
from app.routes.games import ImportRequest, get_game, import_game, list_games
from app.routes.training import get_training_puzzle

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False)


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


# ── 棋局按用户隔离 ───────────────────────────────────────────────

def test_games_isolated_per_user(db):
    a = import_game(ImportRequest(moves="h2e2"), db, user="alice")["id"]
    import_game(ImportRequest(moves="h2e2 h9g7"), db, user="bob")

    alice_games = list_games(limit=50, offset=0, db=db, user="alice")
    assert {g.id for g in alice_games} == {a}

    # bob 看不到 alice 的棋局
    with pytest.raises(HTTPException) as exc:
        get_game(a, db, user="bob")
    assert exc.value.status_code == 404

    # alice 自己能看到
    assert get_game(a, db, user="alice").id == a


# ── 题目可见性：公共题库 + 本人私有题 ──────────────────────────────

def test_puzzle_visibility(db):
    pub = Puzzle(fen="x", solution="a1a2", user_id="default")
    mine = Puzzle(fen="x", solution="a1a2", user_id="alice")
    others = Puzzle(fen="x", solution="a1a2", user_id="bob")
    db.add_all([pub, mine, others])
    db.commit()

    # alice 可见公共题与自己的私有题，看不到 bob 的
    assert repo.get_visible_puzzle(db, pub.id, "alice") is not None
    assert repo.get_visible_puzzle(db, mine.id, "alice") is not None
    assert repo.get_visible_puzzle(db, others.id, "alice") is None

    # 题库计数仅含可见题（公共 + 自己）
    assert repo.count_puzzles(db, "alice") == 2
    assert repo.count_puzzles(db, "bob") == 2
    assert repo.count_puzzles(db, "default") == 1


def test_get_training_puzzle_endpoint(db):
    mine = Puzzle(fen="x", solution="a1a2,b1b2,c1c2", user_id="alice", category="实战漏算")
    others = Puzzle(fen="x", solution="a1a2", user_id="bob")
    db.add_all([mine, others])
    db.commit()

    out = get_training_puzzle(mine.id, db, user="alice")
    assert out.id == mine.id
    assert out.total_steps == 2  # 3 手解法 → 玩家走 2 步

    with pytest.raises(HTTPException) as exc:
        get_training_puzzle(others.id, db, user="alice")
    assert exc.value.status_code == 404


def test_pick_new_puzzle_by_category(db):
    db.add_all([
        Puzzle(fen="x", solution="a1a2", category="马后炮", difficulty=3),
        Puzzle(fen="x", solution="a1a2", category="闷宫", difficulty=3),
    ])
    db.commit()

    picked = repo.pick_new_puzzle(db, "alice", 3, category="闷宫")
    assert picked is not None and picked.category == "闷宫"
