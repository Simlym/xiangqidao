"""LLM 扩展功能测试：训练题 AI 讲解（含缓存）与对弈 AI 点评。

不实际调用 DeepSeek：未配置 key 时应优雅返回 enabled=False；
已缓存讲解时应直接命中缓存而不触发外部请求。
"""
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

MATE_FEN = "9/5k1R1/9/9/9/9/9/9/9/4K4 w"

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


def _make_client(ai_explanation=""):
    eng = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False)
    with TestSession() as db:
        p = Puzzle(fen=MATE_FEN, solution="h8f8", side_to_move="w",
                   category="双车错", difficulty=2, source="test",
                   ai_explanation=ai_explanation)
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


def _without_env_key(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)


def test_explain_disabled_without_key(monkeypatch):
    """未配置 key：返回 enabled=False，不报错。"""
    _without_env_key(monkeypatch)
    client, pid = _make_client()
    r = client.post("/api/training/explain", json={"puzzle_id": pid})
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    assert body["explanation"] == ""


def test_explain_returns_cached_without_llm(monkeypatch):
    """已缓存讲解：即使未配置 key 也直接返回缓存，不再调用大模型。"""
    _without_env_key(monkeypatch)
    client, pid = _make_client(ai_explanation="双车错杀法：两车交替将军。")
    r = client.post("/api/training/explain", json={"puzzle_id": pid})
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["cached"] is True
    assert "双车错" in body["explanation"]


def test_explain_missing_puzzle(monkeypatch):
    _without_env_key(monkeypatch)
    client, pid = _make_client()
    r = client.post("/api/training/explain", json={"puzzle_id": pid + 999})
    assert r.status_code == 404


def test_coach_disabled_without_key(monkeypatch):
    """对弈 AI 点评：未配置 key 时 enabled=False。"""
    _without_env_key(monkeypatch)
    client, _ = _make_client()
    r = client.post("/api/play/coach", json={"fen": INITIAL_FEN, "move": "h2e2"})
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False


def test_coach_rejects_illegal_move(monkeypatch):
    _without_env_key(monkeypatch)
    client, _ = _make_client()
    r = client.post("/api/play/coach", json={"fen": INITIAL_FEN, "move": "a0a9"})
    assert r.status_code == 400
