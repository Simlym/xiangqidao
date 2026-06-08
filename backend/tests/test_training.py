"""训练校验测试：重点覆盖“变着容错”——末步走出等效杀着也应判对。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.deps import get_db
from app.models import Base, Puzzle

# 双车错局面：h7f7 与 h1f1 均为成立的一步杀
MULTI_MATE_FEN = "9/9/5k1R1/9/9/9/9/9/7R1/4K4 w"


def _client_with_puzzle(solution: str):
    eng = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False)

    with TestSession() as db:
        p = Puzzle(
            fen=MULTI_MATE_FEN,
            solution=solution,
            side_to_move="w",
            category="双车错",
            difficulty=1,
            source="test",
        )
        db.add(p)
        db.commit()
        pid = p.id

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), pid


def test_exact_solution_accepted():
    client, pid = _client_with_puzzle("h7f7")
    try:
        r = client.post("/api/training/check_move",
                        json={"puzzle_id": pid, "step": 0, "move": "h7f7"})
        assert r.status_code == 200
        data = r.json()
        assert data["correct"] is True and data["done"] is True
    finally:
        app.dependency_overrides.clear()


def test_alternative_mate_accepted():
    """录入正解是 h7f7，用户走等效杀着 h1f1 也应判对（变着容错）。"""
    client, pid = _client_with_puzzle("h7f7")
    try:
        r = client.post("/api/training/check_move",
                        json={"puzzle_id": pid, "step": 0, "move": "h1f1"})
        assert r.status_code == 200
        data = r.json()
        assert data["correct"] is True
        assert data["done"] is True
    finally:
        app.dependency_overrides.clear()


def test_non_mating_move_rejected():
    """非杀着即便合法也应判错，并给出起点提示。"""
    client, pid = _client_with_puzzle("h7f7")
    try:
        r = client.post("/api/training/check_move",
                        json={"puzzle_id": pid, "step": 0, "move": "h7h8"})
        assert r.status_code == 200
        data = r.json()
        assert data["correct"] is False
        assert data["hint"] == "h7"
    finally:
        app.dependency_overrides.clear()
