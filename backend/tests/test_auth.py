"""测试鉴权与管理员后台。"""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    # 用独立的临时数据库，避免污染开发库
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "test.db")
    monkeypatch.setenv("XQ_SECRET", "test-secret")

    from app import models
    import app.deps as deps
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    eng = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(bind=eng, autoflush=False)
    models.Base.metadata.create_all(eng)

    # 用 setattr，测试结束后自动还原，避免污染其它测试
    monkeypatch.setattr(models, "engine", eng)
    monkeypatch.setattr(models, "SessionLocal", SessionLocal)
    monkeypatch.setattr(deps, "SessionLocal", SessionLocal)

    from app.main import app
    return TestClient(app)


def test_first_user_is_admin(client):
    r = client.post("/api/auth/register", json={"username": "alice", "password": "pass1"})
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_second_user_is_normal(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "pass1"})
    r = client.post("/api/auth/register", json={"username": "bob", "password": "pass2"})
    assert r.status_code == 200
    assert r.json()["role"] == "user"


def test_login_and_me(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "pass1"})
    r = client.post("/api/auth/login", json={"username": "alice", "password": "pass1"})
    token = r.json()["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "alice"


def test_wrong_password_rejected(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "pass1"})
    r = client.post("/api/auth/login", json={"username": "alice", "password": "nope"})
    assert r.status_code == 401


def test_admin_required(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "pass1"})  # admin
    bob = client.post("/api/auth/register", json={"username": "bob", "password": "pass2"})
    token = bob.json()["token"]
    r = client.get("/api/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_admin_can_list_and_create_puzzle(client):
    a = client.post("/api/auth/register", json={"username": "alice", "password": "pass1"})
    token = a.json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    # 列用户
    assert client.get("/api/admin/users", headers=h).status_code == 200
    # 新增一道合法一步杀
    r = client.post("/api/admin/puzzles", headers=h, json={
        "fen": "4k4/R8/8R/9/9/9/9/9/9/3K5", "solution": "i7i9",
        "category": "双车错", "difficulty": 1,
    })
    assert r.status_code == 200
    assert r.json()["verified"] is True
    # 非杀法应被拒
    bad = client.post("/api/admin/puzzles", headers=h, json={
        "fen": "4k4/9/9/9/9/9/9/9/9/3KR4", "solution": "e1e2", "category": "x",
    })
    assert bad.status_code == 400


def test_per_user_data_isolation(client):
    a = client.post("/api/auth/register", json={"username": "alice", "password": "pass1"})
    ta = a.json()["token"]
    # alice 取一题并作答
    nxt = client.get("/api/training/next", headers={"Authorization": f"Bearer {ta}"}).json()
    if nxt["puzzle"]:
        client.post("/api/training/submit",
                    headers={"Authorization": f"Bearer {ta}"},
                    json={"puzzle_id": nxt["puzzle"]["id"], "self_rating": "good"})
    ov_a = client.get("/api/stats/overview", headers={"Authorization": f"Bearer {ta}"}).json()
    b = client.post("/api/auth/register", json={"username": "bob", "password": "pass2"})
    tb = b.json()["token"]
    ov_b = client.get("/api/stats/overview", headers={"Authorization": f"Bearer {tb}"}).json()
    # bob 没有作答记录，learned 为 0，与 alice 隔离
    assert ov_b["learned"] == 0
