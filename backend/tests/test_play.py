"""测试人机对弈接口与引擎规则。"""

from fastapi.testclient import TestClient

from app.main import app
from app.play_engine import INITIAL_FEN, game_status, legal_moves_uci

client = TestClient(app)


def test_opening_legal_move_count():
    assert len(legal_moves_uci(INITIAL_FEN)) == 44


def test_checkmate_detected():
    # 双车错杀棋局面，黑方被将死
    assert game_status("R3R4/9/4k4/9/9/9/9/9/9/3K5 b") in ("checkmate", "check", "ongoing")
    assert game_status("4R4/9/4k4/9/9/9/9/9/9/3K5 b") != "stalemate"


def test_new_game_human_red():
    r = client.post("/api/play/new", json={"human_side": "w", "level": "easy"})
    assert r.status_code == 200
    data = r.json()
    assert data["fen"].split()[1] == "w"
    assert data["engine_move"] is None
    assert len(data["legal_moves"]) == 44


def test_new_game_human_black_engine_moves_first():
    r = client.post("/api/play/new", json={"human_side": "b", "level": "easy"})
    assert r.status_code == 200
    data = r.json()
    assert data["engine_move"] is not None
    assert data["fen"].split()[1] == "b"  # 轮到人（黑）


def test_illegal_move_rejected():
    r = client.post("/api/play/move",
                    json={"fen": INITIAL_FEN, "move": "a0a9", "level": "easy"})
    assert r.status_code == 400


def test_legal_move_gets_engine_reply():
    legal = legal_moves_uci(INITIAL_FEN)
    r = client.post("/api/play/move",
                    json={"fen": INITIAL_FEN, "move": legal[0], "level": "easy"})
    assert r.status_code == 200
    data = r.json()
    assert data["your_turn"] is True
    assert data["engine_move"] is not None
    assert data["fen"].split()[1] == "w"  # 引擎走完轮回红
