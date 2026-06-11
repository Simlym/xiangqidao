"""AI 教练测试：画像汇总、建议规则引擎、进步对比、计划接口（不依赖 LLM）。"""
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.deps import get_db
from app.coach import build_profile, build_progress, build_recommendations
from app.models import Attempt, Base, CoachPlan, Puzzle

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


def test_progress_against_week_old_baseline():
    """与 8 天前的画像基线对比：评分增量、已脱离弱点区的类目应被算出。"""
    TestSession = _session_factory()
    with TestSession() as db:
        baseline_profile = {
            "rating": 1150,
            "solved": 10,
            "first_try_accuracy": 0.5,
            "recent_games": [{"blunders": 4, "mistakes": 2}],
            "weak_categories": [{"category": "卧槽马", "attempts": 3, "accuracy": 0.3}],
        }
        db.add(
            CoachPlan(
                user_id="default",
                created_at=datetime.utcnow() - timedelta(days=8),
                profile_json=json.dumps(baseline_profile, ensure_ascii=False),
            )
        )
        db.commit()

        current = build_profile(db, "default")  # 空数据用户：rating 1200、无弱点
        progress = build_progress(db, "default", current)
        assert progress is not None
        assert progress["days_span"] >= 7
        assert progress["rating_delta"] == 50          # 1200 - 1150
        assert progress["weak_fixed"] == ["卧槽马"]    # 基线弱点已不在当前弱点区
        assert progress["weak_new"] == []
        assert progress["blunders_per_game_before"] == 4.0
        assert progress["blunders_per_game_now"] is None  # 当前无已分析对局


def test_progress_none_without_history():
    TestSession = _session_factory()
    with TestSession() as db:
        current = build_profile(db, "default")
        assert build_progress(db, "default", current) is None


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

    # 首份计划没有历史基线，progress 为空
    assert body["plan"]["progress"] is None

    # 再 GET 应返回刚生成的计划（已持久化）
    r = client.get("/api/coach/plan")
    assert r.json()["plan"]["id"] == body["plan"]["id"]

    # 第二份计划：以首份为基线，progress 出现（跨度可为 0 天）
    r = client.post("/api/coach/plan")
    progress = r.json()["plan"]["progress"]
    assert progress is not None
    assert progress["rating_delta"] == 0
