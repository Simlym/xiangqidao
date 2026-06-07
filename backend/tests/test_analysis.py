"""棋局分析模块测试。"""
import sys
import os

# 确保可以找到 app 模块
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, GameAnalysis, Game
from app.engine import get_engine


# ── 测试 1：GameAnalysis 表创建正常 ──────────────────────────────────────────

def test_game_analysis_table_creation():
    """GameAnalysis 表可以正常建表并插入记录。"""
    engine = sa_create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    with Session() as db:
        # 先创建一个 game 记录
        game = Game(moves="h2e2 h7e7", played_on="2026-01-01")
        db.add(game)
        db.flush()

        record = GameAnalysis(
            game_id=game.id,
            move_index=0,
            fen_before="rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
            move_played="h2e2",
            best_move="h2e2",
            score_cp=15,
            score_mate=None,
            eval_drop=0,
            is_blunder=False,
            is_mistake=False,
            explanation="",
            puzzle_id=None,
        )
        db.add(record)
        db.commit()

        fetched = db.query(GameAnalysis).filter(GameAnalysis.game_id == game.id).first()
        assert fetched is not None
        assert fetched.move_played == "h2e2"
        assert fetched.move_index == 0
        assert fetched.is_blunder is False


# ── 测试 2：引擎未安装时 get_engine() 返回 None ──────────────────────────────

def test_get_engine_returns_none_when_not_installed():
    """pikafish 未安装时，get_engine() 应返回 None 而非抛出异常。"""
    # 传入一个肯定不存在的路径
    result = get_engine(path="/nonexistent/pikafish_binary_xyz")
    assert result is None


def test_get_engine_none_for_default_when_not_installed(monkeypatch):
    """PATH 中没有 pikafish 时，get_engine() 应返回 None。"""
    import shutil
    # 如果真的有 pikafish，跳过此测试
    if shutil.which("pikafish"):
        pytest.skip("pikafish is installed, skipping absence test")

    result = get_engine()
    assert result is None


# ── 测试 3：无引擎时分析接口返回 {status: "analyzing"} 而不报错 ──────────────

def test_analyze_endpoint_returns_analyzing_without_engine():
    """引擎不可用时，POST /analyze 应立即返回 analyzing 状态而非 500 错误。"""
    from unittest.mock import patch
    from sqlalchemy.pool import StaticPool
    from app.main import app
    from app.deps import get_db

    # StaticPool 让所有连接共享同一个内存数据库（跨连接可见）
    test_engine = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(test_engine)
    TestSessionLocal = sessionmaker(bind=test_engine, autoflush=False)

    # 先直接插入一个 game 记录
    with TestSessionLocal() as db:
        game = Game(moves="h2e2 h7e7", played_on="2026-01-01")
        db.add(game)
        db.commit()
        db.refresh(game)
        game_id = game.id

    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    client = TestClient(app)

    # 用 patch 阻止后台任务真正执行（避免其使用真实 SessionLocal）
    with patch("app.routes.analysis._run_analysis"):
        resp = client.post(f"/api/games/{game_id}/analyze")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "analyzing"
    assert data["game_id"] == game_id

    app.dependency_overrides.clear()
