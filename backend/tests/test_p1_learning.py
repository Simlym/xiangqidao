"""P1 学习画像、内容体系、多变着和训练包回归测试。"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.deps import get_db
from app.main import app
from app.models import Attempt, Base, Game, GameAnalysis, Puzzle
from app.puzzle_content import rule_explanation, solution_lines

GUEST = "cccccccccccccccccccccccccccccccc"
HEADERS = {"X-Guest-ID": GUEST}
OWNER = f"guest:{GUEST}"
FEN = "9/9/5k1R1/9/9/9/9/9/7R1/4K4 w"


@pytest.fixture()
def env():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Session = sessionmaker(bind=engine, autoflush=False)
    Base.metadata.create_all(engine)
    with Session() as db:
        db.add_all([
            Puzzle(fen=FEN, solution="h7f7|h7f7", kind="杀法", category="双车错", tags="封锁逃路,子力配合"),
            Puzzle(fen=FEN, solution="h7f7", kind="开局", category="出子效率", tags="中心控制"),
            Puzzle(fen=FEN, solution="h7f7", kind="中局", category="候选着", tags="先手"),
            Puzzle(fen=FEN, solution="h7f7", kind="残局", category="兵卒速度", tags="将帅位置"),
        ])
        db.commit()

    def override():
        with Session() as db:
            yield db
    app.dependency_overrides[get_db] = override
    try:
        yield TestClient(app), Session
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)


def test_multiline_and_free_rule_explanation(env):
    client, Session = env
    assert solution_lines("a1a2,b1b2|c1c2,d1d2") == [["a1a2", "b1b2"], ["c1c2", "d1d2"]]
    with Session() as db:
        text = rule_explanation(db.get(Puzzle, 1))
    assert "连续将军" in text
    response = client.post("/api/training/explain", headers=HEADERS, json={"puzzle_id": 1})
    assert response.status_code == 200 and response.json()["mode"] == "rules"


def test_curriculum_and_unified_mastery(env):
    client, Session = env
    with Session() as db:
        db.add_all([
            Attempt(puzzle_id=1, user_id=OWNER, correct=True, context="challenge"),
            Attempt(puzzle_id=1, user_id=OWNER, correct=False, context="review"),
        ])
        db.commit()
    curriculum = client.get("/api/learning/curriculum", headers=HEADERS).json()
    assert {x["kind"] for x in curriculum} == {"杀法", "开局", "中局", "残局"}
    mastery = client.get("/api/learning/mastery", headers=HEADERS).json()
    category = next(x for x in mastery if x["name"] == "双车错")
    assert category["contexts"] == {"challenge": 1, "review": 1}
    assert category["recurrence_rate"] == 1.0


def test_assessment_pack_has_mixed_content(env):
    client, _ = env
    pack = client.post("/api/learning/assessment/start", headers=HEADERS).json()
    assert pack["type"] == "assessment"
    assert len(pack["puzzle_ids"]) == 4


def test_game_key_problem_pack_uses_top_three(env):
    client, Session = env
    with Session() as db:
        game = Game(user_id=OWNER, moves="h7f7")
        db.add(game)
        db.flush()
        for index, drop in enumerate((100, 400, 250, 300), start=1):
            db.add(GameAnalysis(game_id=game.id, move_index=index, fen_before=FEN,
                move_played="h7f7", best_move="h7f7", eval_drop=drop,
                is_blunder=drop > 200, is_mistake=drop > 80, puzzle_id=index))
        db.commit()
        game_id = game.id
    pack = client.post(f"/api/learning/games/{game_id}/pack", headers=HEADERS)
    assert pack.status_code == 200
    assert pack.json()["puzzle_ids"] == [2, 4, 3]
