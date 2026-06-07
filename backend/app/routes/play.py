"""人机对弈接口（无状态：局面 FEN 由前端持有）。"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..play_engine import (
    INITIAL_FEN,
    choose_move,
    game_status,
    legal_moves_uci,
    side_to_move,
)
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/play", tags=["play"])


class NewGameRequest(BaseModel):
    human_side: str = "w"   # w=红（先手） b=黑
    level: str = "medium"   # easy / medium / hard


class NewGameResponse(BaseModel):
    fen: str
    engine_move: str | None  # 人执黑时引擎（红）先走一步
    status: str
    legal_moves: list[str]


class MoveRequest(BaseModel):
    fen: str
    move: str
    level: str = "medium"


class MoveResponse(BaseModel):
    fen: str               # 人走子（及引擎应着）后的最新局面
    engine_move: str | None
    status: str            # 轮到人时的局面状态
    legal_moves: list[str]
    your_turn: bool
    game_over: bool
    winner: str | None     # "human" / "engine" / "draw" / None


@router.post("/new", response_model=NewGameResponse)
def new_game(req: NewGameRequest):
    fen = INITIAL_FEN
    engine_move = None
    if req.human_side == "b":
        # 人执黑，引擎（红）先走
        engine_move = choose_move(fen, req.level)
        if engine_move:
            fen = apply_move(fen, engine_move)
    return NewGameResponse(
        fen=fen,
        engine_move=engine_move,
        status=game_status(fen),
        legal_moves=legal_moves_uci(fen),
    )


@router.post("/move", response_model=MoveResponse)
def play_move(req: MoveRequest):
    # 1) 校验人走的着法合法
    if req.move not in legal_moves_uci(req.fen):
        raise HTTPException(400, "不合规则的着法")

    fen = apply_move(req.fen, req.move)

    # 2) 人走完后，对方（引擎）是否已被将死/困毙
    status = game_status(fen)
    if status == "checkmate":
        return MoveResponse(fen=fen, engine_move=None, status=status,
                            legal_moves=[], your_turn=False,
                            game_over=True, winner="human")
    if status == "stalemate":
        return MoveResponse(fen=fen, engine_move=None, status=status,
                            legal_moves=[], your_turn=False,
                            game_over=True, winner="draw")

    # 3) 引擎应着
    engine_move = choose_move(fen, req.level)
    if engine_move:
        fen = apply_move(fen, engine_move)

    # 4) 轮到人时的状态
    status = game_status(fen)
    if status == "checkmate":
        return MoveResponse(fen=fen, engine_move=engine_move, status=status,
                            legal_moves=[], your_turn=True,
                            game_over=True, winner="engine")
    if status == "stalemate":
        return MoveResponse(fen=fen, engine_move=engine_move, status=status,
                            legal_moves=[], your_turn=True,
                            game_over=True, winner="draw")

    return MoveResponse(
        fen=fen,
        engine_move=engine_move,
        status=status,
        legal_moves=legal_moves_uci(fen),
        your_turn=True,
        game_over=False,
        winner=None,
    )
