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
                        json={"puzzle_id": pid, "step": 0, "move": "h7h8", "attempt": 0})
        assert r.status_code == 200
        data = r.json()
        assert data["correct"] is False
        assert "h7" in data["hint"]
    finally:
        app.dependency_overrides.clear()


def test_graded_hint_escalates():
    """错的次数越多，提示透露越多：起点 → 棋子名 → 完整正解。"""
    client, pid = _client_with_puzzle("h7f7")
    try:
        def hint(attempt):
            return client.post("/api/training/check_move",
                               json={"puzzle_id": pid, "step": 0, "move": "h7h8",
                                     "attempt": attempt}).json()["hint"]
        assert "h7" in hint(0)
        assert "车" in hint(1)            # h7 处是白车
        assert "f7" in hint(2) and "h7" in hint(2)  # 完整正解含起点与终点
    finally:
        app.dependency_overrides.clear()


def _client_multi(n: int):
    """建 n 道新题的内存库客户端。"""
    eng = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False)
    with TestSession() as db:
        for i in range(n):
            db.add(Puzzle(fen=MULTI_MATE_FEN, solution=f"h7f{i}", side_to_move="w",
                          category="测试", difficulty=1, source="t"))
        db.commit()

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_first_try_accuracy_excludes_retry():
    """首答正确率只统计未重试且做对的作答。"""
    client = _client_multi(2)
    try:
        # 第 1 题：一次做对（first try）
        client.post("/api/training/submit",
                    json={"puzzle_id": 1, "self_rating": "good", "had_retry": False, "correct": True})
        # 第 2 题：重试后做对（非 first try）
        client.post("/api/training/submit",
                    json={"puzzle_id": 2, "self_rating": "good", "had_retry": True, "correct": True})
        ov = client.get("/api/stats/overview").json()
        assert ov["overall_accuracy"] == 1.0       # 两次都最终做对
        assert ov["first_try_accuracy"] == 0.5      # 只有 1/2 是首答对
    finally:
        app.dependency_overrides.clear()


def test_daily_new_limit(monkeypatch):
    """达到每日新题上限后不再发新题，并置 new_limit_reached。"""
    import app.routes.training as t
    monkeypatch.setattr(t, "NEW_PER_DAY", 1)
    client = _client_multi(2)
    try:
        first = client.get("/api/training/next").json()
        assert first["puzzle"] is not None
        # 学掉这道新题（生成 created_at=today 的 Review）
        client.post("/api/training/submit",
                    json={"puzzle_id": first["puzzle"]["id"], "self_rating": "good",
                          "had_retry": False, "correct": True})
        nxt = client.get("/api/training/next").json()
        assert nxt["puzzle"] is None
        assert nxt["new_limit_reached"] is True
    finally:
        app.dependency_overrides.clear()
