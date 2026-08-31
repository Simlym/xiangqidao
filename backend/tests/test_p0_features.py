"""P0 主路径、游客隔离与可信结算回归测试。"""

import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.deps import get_db
from app.main import app
from app import credits
from app.models import Attempt, Base, Puzzle, User

FEN = "9/9/5k1R1/9/9/9/9/9/7R1/4K4 w"
SOLUTION = "h7f7"
GUEST_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
GUEST_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"


@pytest.fixture()
def env():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Session = sessionmaker(bind=engine, autoflush=False)
    Base.metadata.create_all(engine)
    with Session() as db:
        db.add(Puzzle(
            fen=FEN, solution=SOLUTION, side_to_move="w", category="双车错",
            difficulty=1, source="test", user_id="default",
        ))
        db.commit()

    def override_get_db():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), Session
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)


def _headers(guest):
    return {"X-Guest-ID": guest}


def _finish_first(client, guest=GUEST_A):
    headers = _headers(guest)
    puzzle = client.get("/api/training/next", headers=headers).json()["puzzle"]
    premature = client.post("/api/training/submit", headers=headers, json={
        "puzzle_id": puzzle["id"], "session_id": puzzle["session_id"],
        "self_rating": "good", "correct": True,
    })
    assert premature.status_code == 409
    checked = client.post("/api/training/check_move", headers=headers, json={
        "puzzle_id": puzzle["id"], "session_id": puzzle["session_id"],
        "step": 0, "move": SOLUTION,
    })
    assert checked.status_code == 200 and checked.json()["done"] is True
    settled = client.post("/api/training/submit", headers=headers, json={
        "puzzle_id": puzzle["id"], "session_id": puzzle["session_id"],
        "self_rating": "good", "correct": True,
    })
    assert settled.status_code == 200
    return puzzle


def test_server_session_and_guest_isolation(env):
    client, _ = env
    _finish_first(client)
    a = client.get("/api/stats/overview", headers=_headers(GUEST_A)).json()
    b = client.get("/api/stats/overview", headers=_headers(GUEST_B)).json()
    assert a["learned"] == 1 and a["first_try_accuracy"] == 1.0
    assert b["learned"] == 0 and b["first_try_accuracy"] == 0.0


def test_register_claims_device_progress(env):
    client, _ = env
    _finish_first(client)
    auth = client.post("/api/auth/register", headers=_headers(GUEST_A), json={
        "username": "alice", "password": "password123",
    })
    assert auth.status_code == 200
    token = auth.json()["token"]
    overview = client.get("/api/stats/overview", headers={"Authorization": f"Bearer {token}"}).json()
    assert overview["learned"] == 1


def test_private_blunder_enters_today_and_is_picked_first(env):
    client, Session = env
    owner = f"guest:{GUEST_A}"
    with Session() as db:
        private = Puzzle(
            fen=FEN, solution=SOLUTION, side_to_move="w", category="实战漏算",
            difficulty=2, source="game_1_move_3", user_id=owner,
        )
        db.add(private)
        db.commit()
        private_id = private.id
    today = client.get("/api/today", headers=_headers(GUEST_A)).json()
    assert today["pending_blunders"] == 1
    assert any(a["type"] == "category" for a in today["actions"])
    next_puzzle = client.get("/api/training/next", headers=_headers(GUEST_A)).json()["puzzle"]
    assert next_puzzle["id"] == private_id


def test_first_attempt_statistics_are_deduplicated(env):
    client, Session = env
    owner = f"guest:{GUEST_A}"
    with Session() as db:
        second = Puzzle(
            fen=FEN, solution=SOLUTION, side_to_move="w", category="双车错",
            difficulty=1, source="test2", user_id="default",
        )
        db.add(second)
        db.flush()
        db.add_all([
            Attempt(puzzle_id=1, user_id=owner, correct=False, had_retry=True),
            Attempt(puzzle_id=1, user_id=owner, correct=True, had_retry=False),
            Attempt(puzzle_id=1, user_id=owner, correct=True, had_retry=False),
            Attempt(puzzle_id=second.id, user_id=owner, correct=True, had_retry=False),
        ])
        db.commit()
    overview = client.get("/api/stats/overview", headers=_headers(GUEST_A)).json()
    categories = client.get("/api/stats/by_category", headers=_headers(GUEST_A)).json()
    assert overview["overall_accuracy"] == 0.75
    assert overview["first_try_accuracy"] == 0.5
    assert categories == [{"category": "双车错", "attempts": 2, "accuracy": 0.5}]


def test_pro_ai_is_included_and_free_user_uses_credits(env):
    _, Session = env
    with Session() as db:
        free = User(username="free", password_hash="x", role="user")
        pro = User(
            username="pro", password_hash="x", role="user", plan="pro",
            membership_expires_at=datetime.utcnow() + timedelta(days=7),
        )
        db.add_all([free, pro])
        db.commit()
        credits.grant_signup(db, "free")
        before = credits.balance(db, "free")
        assert credits.charge(db, "free", "coach_plan", "test") is True
        assert credits.balance(db, "free") == before - credits.cost(db, "coach_plan")
        assert credits.charge(db, "pro", "coach_plan", "test") is True
        assert credits.balance(db, "pro") == 0
