"""积分系统测试：账户/赚取/消耗的服务逻辑，以及接口的登录要求与扣费门槛。

不实际调用 DeepSeek：以 monkeypatch 替换大模型函数，只验证「门槛 + 扣费 + 退款」。
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import credits
from app.main import app
from app.auth import hash_password, make_token
from app.deps import get_db
from app.models import Base, CreditAccount, Puzzle, User
from app.settings import KEY_DEEPSEEK_API_KEY, KEY_DEEPSEEK_ENABLED, set_setting

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


def _add_user(TestSession, name="tester"):
    with TestSession() as db:
        db.add(User(username=name, password_hash=hash_password("password1")))
        db.commit()


def _auth(name="tester"):
    return {"Authorization": f"Bearer {make_token(name)}"}


# ── 服务层 ──────────────────────────────────────────────────────

def test_signup_grant_once():
    TestSession = _session_factory()
    with TestSession() as db:
        assert credits.grant_signup(db, "alice") == credits.DEFAULT_SIGNUP_GRANT
        assert credits.balance(db, "alice") == credits.DEFAULT_SIGNUP_GRANT


def test_guest_has_no_account_and_cannot_spend():
    TestSession = _session_factory()
    with TestSession() as db:
        assert credits.balance(db, "default") == 0
        assert credits.try_spend(db, "default", "coach_plan") is False


def test_checkin_idempotent_and_streak():
    TestSession = _session_factory()
    with TestSession() as db:
        r1 = credits.checkin(db, "alice")
        assert r1["already"] is False and r1["awarded"] == credits.DEFAULT_EARN["checkin"]
        assert r1["streak"] == 1
        # 同日再签到不再发放
        r2 = credits.checkin(db, "alice")
        assert r2["already"] is True and r2["awarded"] == 0

        # 模拟昨天已签到 → 今日连签 streak=2，含递增奖励
        acc = db.get(CreditAccount, "alice")
        acc.last_checkin = date.today() - timedelta(days=1)
        acc.checkin_streak = 1
        db.commit()
        r3 = credits.checkin(db, "alice")
        assert r3["streak"] == 2
        assert r3["awarded"] == credits.DEFAULT_EARN["checkin"] + credits.DEFAULT_CHECKIN_STREAK_STEP


def test_earn_respects_daily_cap():
    TestSession = _session_factory()
    with TestSession() as db:
        cap = credits.DEFAULT_DAILY_CAP["puzzle"]
        per = credits.DEFAULT_EARN["puzzle"]
        total = 0
        for _ in range(cap // per + 5):
            total += credits.earn(db, "alice", "puzzle")
        assert total == cap  # 不超过每日上限


def test_award_game_requires_min_moves():
    TestSession = _session_factory()
    with TestSession() as db:
        assert credits.award_game(db, "alice", move_count=4) == 0
        assert credits.award_game(db, "alice", move_count=40) == credits.DEFAULT_EARN["game"]


def test_spend_and_refund():
    TestSession = _session_factory()
    with TestSession() as db:
        credits.grant_signup(db, "alice")
        start = credits.balance(db, "alice")
        assert credits.try_spend(db, "alice", "coach_plan") is True
        assert credits.balance(db, "alice") == start - credits.DEFAULT_COST["coach_plan"]
        credits.refund(db, "alice", "coach_plan")
        assert credits.balance(db, "alice") == start


def test_try_spend_blocks_when_insufficient():
    TestSession = _session_factory()
    with TestSession() as db:
        credits.get_account(db, "poor")  # 余额 0
        db.commit()
        assert credits.try_spend(db, "poor", "coach_plan") is False


# ── 接口层 ──────────────────────────────────────────────────────

def test_credits_me_requires_login():
    TestSession = _session_factory()
    client = _client(TestSession)
    assert client.get("/api/credits/me").status_code == 401


def test_checkin_endpoint_awards():
    TestSession = _session_factory()
    _add_user(TestSession)
    client = _client(TestSession)
    r = client.post("/api/credits/checkin", headers=_auth())
    assert r.status_code == 200
    body = r.json()
    assert body["awarded"] == credits.DEFAULT_EARN["checkin"]
    # /me 反映余额与签到状态
    me = client.get("/api/credits/me", headers=_auth()).json()
    assert me["balance"] == body["balance"]
    assert me["checkin_today"] is True
    assert me["costs"]["coach_plan"] == credits.DEFAULT_COST["coach_plan"]


def test_coach_plan_blocks_when_no_credits(monkeypatch):
    """大模型已启用但用户积分为 0 时，刷新计划返回 402，不会调用大模型。"""
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    TestSession = _session_factory()
    _add_user(TestSession)
    with TestSession() as db:
        set_setting(db, KEY_DEEPSEEK_ENABLED, "1")
        set_setting(db, KEY_DEEPSEEK_API_KEY, "sk-test")
        db.commit()
    client = _client(TestSession)
    r = client.post("/api/coach/plan", headers=_auth())
    assert r.status_code == 402


def test_explain_charges_credits(monkeypatch):
    """已登录、有积分、大模型启用：题目讲解扣费并返回讲解；大模型函数被替身拦截。"""
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr("app.routes.training.explain_puzzle", lambda *a, **k: "测试讲解")
    TestSession = _session_factory()
    with TestSession() as db:
        db.add(User(username="tester", password_hash=hash_password("password1")))
        credits.grant_signup(db, "tester")
        set_setting(db, KEY_DEEPSEEK_ENABLED, "1")
        set_setting(db, KEY_DEEPSEEK_API_KEY, "sk-test")
        p = Puzzle(fen=MATE_FEN, solution="h8f8", side_to_move="w",
                   category="双车错", difficulty=2, source="test")
        db.add(p)
        db.commit()
        pid = p.id
        before = credits.balance(db, "tester")

    client = _client(TestSession)
    r = client.post("/api/training/explain", json={"puzzle_id": pid}, headers=_auth())
    assert r.status_code == 200
    assert r.json()["explanation"] == "测试讲解"

    with TestSession() as db:
        assert credits.balance(db, "tester") == before - credits.DEFAULT_COST["puzzle_explain"]
