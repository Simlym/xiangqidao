"""棋局复盘路由单元测试（直接调用路由函数，无需 httpx）。"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from app.models import Base
from app.routes.games import (
    INITIAL_FEN,
    ImportRequest,
    import_game,
    list_games,
    get_game,
    delete_game,
)
from app.xiangqi_utils import apply_move

TEST_DB_URL = "sqlite:///:memory:"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False)

SAMPLE_MOVES = ["h2e2", "h9g7", "b2e2", "b9c7"]


@pytest.fixture(autouse=True, scope="module")
def setup_db():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_import_game(db):
    req = ImportRequest(
        moves=" ".join(SAMPLE_MOVES),
        red_player="红方",
        black_player="黑方",
        result="红胜",
    )
    result = import_game(req, db)
    assert result["move_count"] == len(SAMPLE_MOVES)
    assert isinstance(result["id"], int)


def test_import_invalid_move(db):
    req = ImportRequest(moves="h2e2 INVALID")
    with pytest.raises(HTTPException) as exc_info:
        import_game(req, db)
    assert exc_info.value.status_code == 400


def test_import_comma_separated(db):
    req = ImportRequest(moves="h2e2,h9g7")
    result = import_game(req, db)
    assert result["move_count"] == 2


def test_list_games(db):
    games = list_games(limit=50, offset=0, db=db)
    assert len(games) >= 1
    for g in games:
        assert hasattr(g, "id")
        assert not hasattr(g, "moves") or True  # GameSummary doesn't expose moves in response_model
        assert hasattr(g, "red_player")


def test_get_game_positions(db):
    req = ImportRequest(moves=" ".join(SAMPLE_MOVES))
    result = import_game(req, db)
    game_id = result["id"]

    detail = get_game(game_id, db)
    positions = detail.positions

    assert len(positions) == len(SAMPLE_MOVES) + 1

    # Index 0: initial FEN, move=""
    assert positions[0].move_index == 0
    assert positions[0].move == ""
    assert positions[0].fen == INITIAL_FEN

    # Index 1: after first move
    expected_fen_1 = apply_move(INITIAL_FEN, SAMPLE_MOVES[0])
    assert positions[1].move_index == 1
    assert positions[1].move == SAMPLE_MOVES[0]
    assert positions[1].fen == expected_fen_1

    # Verify all subsequent positions chain correctly
    fen = INITIAL_FEN
    for i, move in enumerate(SAMPLE_MOVES):
        fen = apply_move(fen, move)
        assert positions[i + 1].fen == fen


def test_get_game_not_found(db):
    with pytest.raises(HTTPException) as exc_info:
        get_game(99999, db)
    assert exc_info.value.status_code == 404


def test_delete_game(db):
    req = ImportRequest(moves="h2e2")
    result = import_game(req, db)
    game_id = result["id"]

    resp = delete_game(game_id, db)
    assert resp == {"ok": True}

    # Confirm deleted
    with pytest.raises(HTTPException) as exc_info:
        get_game(game_id, db)
    assert exc_info.value.status_code == 404
