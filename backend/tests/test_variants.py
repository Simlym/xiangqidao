"""双棋类引擎接口测试。"""

from fastapi.testclient import TestClient

from app.main import app
from app.routes import variants

client = TestClient(app)
JIEQI_FEN = "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w A2B2N2R2C2P5a2b2n2r2c2p5 - 0 1"


def test_jieqi_engine_unavailable(monkeypatch):
    monkeypatch.setattr(variants, "get_shared_jieqi_engine", lambda: None)
    response = client.post("/api/variants/jieqi/eval", json={"fen": JIEQI_FEN, "depth": 6})
    assert response.status_code == 503


def test_jieqi_engine_response(monkeypatch):
    class Result:
        score_cp = 32
        score_mate = None
        best_move = "a3a4R"
        pv = ["a3a4R", "a6a5p"]

    class FakeEngine:
        def analyze(self, fen, depth):
            assert fen == JIEQI_FEN
            assert depth == 8
            return Result()

    monkeypatch.setattr(variants, "get_shared_jieqi_engine", lambda: FakeEngine())
    response = client.post("/api/variants/jieqi/eval", json={"fen": JIEQI_FEN, "depth": 8})
    assert response.status_code == 200
    assert response.json()["best_move"] == "a3a4R"
    assert response.json()["cp"] == 32


def test_jieqi_stream_emits_info_and_final(monkeypatch):
    class Result:
        score_cp = 48
        score_mate = None
        best_move = "a3a4R"
        pv = ["a3a4R", "a6a5p"]
        depth = 9
        seldepth = 12
        nodes = 1200
        nps = 24000
        time_ms = 50
        wdl = (420, 410, 170)
        lines = [{
            "multipv": 1, "depth": 9, "score_cp": 48,
            "pv": ["a3a4R", "a6a5p"], "wdl": (420, 410, 170),
        }]

    class FakeEngine:
        def analyze(self, fen, **options):
            options["on_info"]({
                "multipv": 1, "depth": 8, "score_cp": 40,
                "pv": ["a3a4R"], "nps": 20000,
            })
            return Result()

    monkeypatch.setattr(variants, "get_shared_jieqi_engine", lambda: FakeEngine())
    response = client.post("/api/variants/jieqi/eval/stream", json={
        "fen": JIEQI_FEN, "mode": "movetime", "value": 500, "show_wdl": True,
    })
    assert response.status_code == 200
    events = [__import__("json").loads(line) for line in response.text.splitlines()]
    assert [event["type"] for event in events] == ["info", "complete"]
    assert events[0]["data"]["depth"] == 8
    assert events[1]["data"]["best_move"] == "a3a4R"

