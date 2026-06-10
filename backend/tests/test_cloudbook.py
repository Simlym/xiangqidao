"""测试云库客户端的解析/选着逻辑与代理接口。外网请求一律打桩。"""

from fastapi.testclient import TestClient

from app import cloudbook
from app.main import app
from app.play_engine import INITIAL_FEN

client = TestClient(app)

SAMPLE = (
    "move:h2e2,score:30,rank:2,note:! (主要变着),winrate:54.35"
    "|move:b0c2,score:21,rank:1,note:* (常见着法),winrate:52.10"
    "|move:a0a1,score:-5,rank:0,note:? (冷门着法),winrate:48.00\x00"
)


def test_parse_response_sorted_by_score():
    moves = cloudbook.parse_response(SAMPLE)
    assert [m["uci"] for m in moves] == ["h2e2", "b0c2", "a0a1"]
    assert moves[0]["score"] == 30
    assert moves[0]["winrate"] == 54.35
    assert moves[0]["note"].startswith("!")


def test_parse_response_no_data():
    assert cloudbook.parse_response("unknown") == []
    assert cloudbook.parse_response("") == []
    assert cloudbook.parse_response("invalid board") == []


def test_ply_of():
    assert cloudbook.ply_of(INITIAL_FEN) == 0
    assert cloudbook.ply_of("9/9/9/9/9/9/9/9/9/9 b - - 0 1") == 1
    assert cloudbook.ply_of("9/9/9/9/9/9/9/9/9/9 w - - 0 13") == 24


def test_best_book_move_levels(monkeypatch):
    monkeypatch.setattr(cloudbook, "query_book", lambda fen: cloudbook.parse_response(SAMPLE))
    # hard 选最优；easy 不用云库
    assert cloudbook.best_book_move(INITIAL_FEN, "hard") == "h2e2"
    assert cloudbook.best_book_move(INITIAL_FEN, "easy") is None
    # medium 在最优 50cp 内随机
    assert cloudbook.best_book_move(INITIAL_FEN, "medium") in ("h2e2", "b0c2")


def test_best_book_move_respects_opening_limit(monkeypatch):
    monkeypatch.setattr(cloudbook, "query_book", lambda fen: cloudbook.parse_response(SAMPLE))
    midgame = "9/9/9/9/9/9/9/9/9/9 w - - 0 30"  # 第 58 个半着，超出开局范围
    assert cloudbook.best_book_move(midgame, "hard") is None


def test_query_book_uses_cache(monkeypatch):
    calls = []

    def fake_fetch(key):
        calls.append(key)
        return SAMPLE

    monkeypatch.setattr(cloudbook, "_fetch", fake_fetch)
    cloudbook._cache.clear()
    a = cloudbook.query_book(INITIAL_FEN)
    b = cloudbook.query_book(INITIAL_FEN)
    assert a == b and len(a) == 3
    assert len(calls) == 1  # 第二次命中缓存


def test_query_book_breaker_on_failures(monkeypatch):
    def boom(key):
        raise OSError("network down")

    monkeypatch.setattr(cloudbook, "_fetch", boom)
    cloudbook._cache.clear()
    cloudbook._break_until = 0.0
    cloudbook._fail_count = 0
    fen = "9/9/9/9/9/9/9/9/9/9 w - - 0 1"
    for _ in range(cloudbook._BREAK_AFTER):
        assert cloudbook.query_book(fen) is None
    assert cloudbook._break_until > 0  # 已熔断
    cloudbook._break_until = 0.0


def test_book_route(monkeypatch):
    monkeypatch.setattr(cloudbook, "query_book", lambda fen: cloudbook.parse_response(SAMPLE))
    r = client.get("/api/play/book", params={"fen": INITIAL_FEN})
    assert r.status_code == 200
    data = r.json()
    assert data["available"] is True
    assert data["moves"][0]["uci"] == "h2e2"


def test_book_route_unavailable(monkeypatch):
    monkeypatch.setattr(cloudbook, "query_book", lambda fen: None)
    r = client.get("/api/play/book", params={"fen": INITIAL_FEN})
    assert r.status_code == 200
    assert r.json() == {"available": False, "moves": []}


def test_hint_route_prefers_book(monkeypatch):
    monkeypatch.setattr(cloudbook, "best_book_move", lambda fen, level="hard": "h2e2")
    r = client.post("/api/play/hint", json={"fen": INITIAL_FEN})
    assert r.status_code == 200
    assert r.json() == {"move": "h2e2", "source": "book"}


def test_hint_route_engine_fallback(monkeypatch):
    monkeypatch.setattr(cloudbook, "best_book_move", lambda fen, level="hard": None)
    r = client.post("/api/play/hint", json={"fen": INITIAL_FEN})
    assert r.status_code == 200
    data = r.json()
    assert data["source"] == "engine"
    assert data["move"]  # 内置搜索必有着法
