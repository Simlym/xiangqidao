"""人机对弈接口（无状态：局面 FEN 由前端持有）。"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import cloudbook
from ..deps import get_db
from ..llm import coach_move
from ..play_engine import (
    INITIAL_FEN,
    choose_move,
    evaluate_position,
    game_status,
    legal_moves_uci,
    side_to_move,
)
from ..ratelimit import limiter
from ..settings import get_deepseek_config
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/play", tags=["play"])

# 合法象棋 FEN 不会超过约 90 字符，限长防超大串拖垮引擎/解析
_FEN_MAX = 120


class NewGameRequest(BaseModel):
    human_side: str = "w"   # w=红（先手） b=黑
    level: str = "medium"   # easy / medium / hard


class NewGameResponse(BaseModel):
    fen: str
    engine_move: str | None  # 人执黑时引擎（红）先走一步
    status: str
    legal_moves: list[str]


class MoveRequest(BaseModel):
    fen: str = Field(max_length=_FEN_MAX)
    move: str = Field(max_length=5)
    level: str = "medium"


class MoveResponse(BaseModel):
    fen: str               # 人走子（及引擎应着）后的最新局面
    engine_move: str | None
    status: str            # 轮到人时的局面状态
    legal_moves: list[str]
    your_turn: bool
    game_over: bool
    winner: str | None     # "human" / "engine" / "draw" / None


class EvalRequest(BaseModel):
    fen: str = Field(max_length=_FEN_MAX)


class EvalResponse(BaseModel):
    cp: int | None = None    # 红方视角 centipawn，正=红优、负=黑优
    mate: int | None = None  # 红方视角几步杀，正=红方可杀、负=黑方可杀


@router.post("/eval", response_model=EvalResponse)
@limiter.limit("60/minute")
def eval_position(request: Request, req: EvalRequest):
    """评估给定局面的优劣势（红方视角），供对弈界面的评估条按需调用。"""
    e = evaluate_position(req.fen)
    return EvalResponse(cp=e["cp"], mate=e["mate"])


class EngineResponse(BaseModel):
    engine: str       # "pikafish" / "builtin"
    label: str        # 展示用名称
    available: bool   # 是否为强力引擎（Pikafish）


@router.get("/engine", response_model=EngineResponse)
def engine_info():
    """报告当前对弈/评分实际使用的引擎，供前端显示。"""
    from ..engine import get_shared_engine

    eng = get_shared_engine()
    if eng is not None:
        import os

        name = os.path.basename(eng.path) if getattr(eng, "path", None) else "Pikafish"
        return EngineResponse(engine="pikafish", label=f"Pikafish（{name}）", available=True)
    return EngineResponse(engine="builtin", label="内置搜索引擎", available=False)


class BookMove(BaseModel):
    uci: str
    score: int | None = None    # 走子方视角 centipawn
    rank: int | None = None     # 云库推荐等级（越大越优）
    winrate: float | None = None
    note: str | None = None


class BookResponse(BaseModel):
    available: bool          # 云库是否可用（关闭/网络异常时 False）
    moves: list[BookMove]


@router.get("/book", response_model=BookResponse)
@limiter.limit("60/minute")
def query_book(request: Request, fen: str = Query(max_length=_FEN_MAX)):
    """查询当前局面的云库着法（含评分/胜率），供前端开局参考面板使用。

    后端代理外部云库：统一缓存、规避浏览器跨域限制。
    """
    moves = cloudbook.query_book(fen)
    if moves is None:
        return BookResponse(available=False, moves=[])
    return BookResponse(available=True, moves=[BookMove(**m) for m in moves])


class HintRequest(BaseModel):
    fen: str = Field(max_length=_FEN_MAX)


class HintResponse(BaseModel):
    move: str | None
    source: str  # "book" / "engine"


@router.post("/hint", response_model=HintResponse)
@limiter.limit("20/minute")
def hint(request: Request, req: HintRequest):
    """给出当前局面的推荐着法：云库命中即用，否则引擎搜索。

    供前端「提示」按钮在浏览器本地引擎不可用时降级调用。
    """
    legal = legal_moves_uci(req.fen)
    if not legal:
        return HintResponse(move=None, source="engine")
    book = cloudbook.best_book_move(req.fen, "hard")
    if book and book in legal:
        return HintResponse(move=book, source="book")
    return HintResponse(move=choose_move(req.fen, "hard"), source="engine")


class CoachRequest(BaseModel):
    fen: str = Field(max_length=_FEN_MAX)
    move: str = Field(max_length=5)


class CoachResponse(BaseModel):
    enabled: bool   # AI 点评是否可用（未配置 key 时 False）
    text: str


@router.post("/coach", response_model=CoachResponse)
@limiter.limit("10/minute")
def coach(request: Request, req: CoachRequest, db: Session = Depends(get_db)):
    """AI 教练点评一步推荐着法的意图，供「提示」面板的「AI 详解」按钮调用。"""
    if req.move not in legal_moves_uci(req.fen):
        raise HTTPException(400, "不合规则的着法")
    if not get_deepseek_config(db).active:
        return CoachResponse(enabled=False, text="")
    side = "红方" if side_to_move(req.fen) == "w" else "黑方"
    return CoachResponse(enabled=True, text=coach_move(req.fen, req.move, side))


@router.post("/new", response_model=NewGameResponse)
@limiter.limit("30/minute")
def new_game(request: Request, req: NewGameRequest):
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
@limiter.limit("120/minute")
def play_move(request: Request, req: MoveRequest):
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
