"""LLM 扩展功能测试：训练题 AI 讲解（含缓存）与对弈 AI 点评。

不实际调用 DeepSeek：未配置 key 时应优雅返回 enabled=False；
已缓存讲解时应直接命中缓存而不触发外部请求。
这些功能现在要求登录（防止未登录用户刷大模型），测试统一携带 token。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.auth import hash_password, make_token
from app.deps import get_db
from app.models import Base, Puzzle, User

MATE_FEN = "9/5k1R1/9/9/9/9/9/9/9/4K4 w"

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

AUTH = {"Authorization": f"Bearer {make_token('tester')}"}


def _make_client(ai_explanation=""):
    eng = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False)
    with TestSession() as db:
        db.add(User(username="tester", password_hash=hash_password("password1")))
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


def test_explain_requires_login(monkeypatch):
    """未登录调用大模型功能应被拒（401），杜绝匿名刷接口。"""
    _without_env_key(monkeypatch)
    client, pid = _make_client()
    r = client.post("/api/training/explain", json={"puzzle_id": pid})
    assert r.status_code == 401


def test_coach_requires_login(monkeypatch):
    _without_env_key(monkeypatch)
    client, _ = _make_client()
    r = client.post("/api/play/coach", json={"fen": INITIAL_FEN, "move": "h2e2"})
    assert r.status_code == 401


def test_explain_disabled_without_key(monkeypatch):
    """已登录但未配置 key：返回 enabled=False，不报错、不扣分。"""
    _without_env_key(monkeypatch)
    client, pid = _make_client()
    r = client.post("/api/training/explain", json={"puzzle_id": pid}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    assert body["explanation"] == ""


def test_explain_returns_cached_without_llm(monkeypatch):
    """已缓存讲解：即使未配置 key 也直接返回缓存，不再调用大模型、不扣分。"""
    _without_env_key(monkeypatch)
    client, pid = _make_client(ai_explanation="双车错杀法：两车交替将军。")
    r = client.post("/api/training/explain", json={"puzzle_id": pid}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["cached"] is True
    assert "双车错" in body["explanation"]


def test_explain_missing_puzzle(monkeypatch):
    _without_env_key(monkeypatch)
    client, pid = _make_client()
    r = client.post("/api/training/explain", json={"puzzle_id": pid + 999}, headers=AUTH)
    assert r.status_code == 404


def test_coach_disabled_without_key(monkeypatch):
    """对弈 AI 点评：已登录但未配置 key 时 enabled=False。"""
    _without_env_key(monkeypatch)
    client, _ = _make_client()
    r = client.post("/api/play/coach", json={"fen": INITIAL_FEN, "move": "h2e2"}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False


def test_coach_rejects_illegal_move(monkeypatch):
    _without_env_key(monkeypatch)
    client, _ = _make_client()
    r = client.post("/api/play/coach", json={"fen": INITIAL_FEN, "move": "a0a9"}, headers=AUTH)
    assert r.status_code == 400
