"""AI 教练测试：画像汇总、建议规则引擎、计划接口（不依赖 LLM）。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.deps import get_db
from app.coach import build_profile, build_recommendations
from app.models import Attempt, Base, Puzzle

MATE_FEN = "9/5k1R1/9/9/9/9/9/9/9/4K4 w"


def _session_factory():
    eng = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False)


def _client(TestSession):
    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_profile_and_recs_empty_user():
    """零数据用户：画像不报错，建议退化为「下一盘对弈」。"""
    TestSession = _session_factory()
    with TestSession() as db:
        profile = build_profile(db, "default")
        assert profile["rating"] == 1200
        assert profile["weak_categories"] == []
        recs = build_recommendations(profile)
        assert any(r["type"] == "play" for r in recs)


def test_weak_category_detected():
    """某类目 3 次作答全错：应识别为弱点并给出专项建议。"""
    TestSession = _session_factory()
    with TestSession() as db:
        p = Puzzle(fen=MATE_FEN, solution="h8f8", side_to_move="w",
                   category="卧槽马", difficulty=2, source="test")
        db.add(p)
        db.flush()
        for _ in range(3):
            db.add(Attempt(puzzle_id=p.id, user_id="default", correct=False))
        db.commit()

        profile = build_profile(db, "default")
        assert profile["weak_categories"], "应检出弱点类目"
        assert profile["weak_categories"][0]["category"] == "卧槽马"
        recs = build_recommendations(profile)
        assert any(r.get("category") == "卧槽马" for r in recs)


def test_plan_endpoints(monkeypatch):
    """GET 无计划返回 null；POST 生成计划（无 LLM 时 plan_text 为空但建议可用）。"""
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    TestSession = _session_factory()
    client = _client(TestSession)

    r = client.get("/api/coach/plan")
    assert r.status_code == 200
    assert r.json()["plan"] is None

    r = client.post("/api/coach/plan")
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] is not None
    assert body["plan"]["plan_text"] == ""           # LLM 未配置
    assert len(body["plan"]["recommendations"]) >= 1  # 规则引擎兜底
    assert body["plan"]["trigger"] == "manual"

    # 再 GET 应返回刚生成的计划（已持久化）
    r = client.get("/api/coach/plan")
    assert r.json()["plan"]["id"] == body["plan"]["id"]
