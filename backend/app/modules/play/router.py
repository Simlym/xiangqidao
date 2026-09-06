"""人机对弈接口（无状态：局面 FEN 由前端持有）。"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.integrations import cloudbook
from app.modules.credits import service as credits
from app.modules.auth.service import current_user
from app.core.dependencies import get_db
from app.engine.contract import EngineEvalResponse, response_from_result, stream_engine
from app.integrations.llm import coach_move
from app.core.models import User
from .schemas import (
    FEN_MAX,
    BookMove,
    BookResponse,
    CoachRequest,
    CoachResponse,
    EngineResponse,
    EvalRequest,
    HintRequest,
    HintResponse,
    MoveRequest,
    MoveResponse,
    NewGameRequest,
    NewGameResponse,
    StateRequest,
    StateResponse,
)
from .service import (
    INITIAL_FEN,
    choose_move,
    evaluate_position,
    game_status,
    legal_moves_uci,
    side_to_move,
)
from app.core.rate_limit import limiter
from app.core.settings import get_llm_config
from app.shared.xiangqi import apply_move

router = APIRouter(prefix="/api/play", tags=["play"])


@router.post("/state", response_model=StateResponse)
@limiter.limit("240/minute")
def position_state(request: Request, req: StateRequest):
    """只校验局面并返回合法着法，不启动引擎。

    PC/WASM 在本地计算引擎应着后通过该接口复用服务端权威棋规；计算失败时
    客户端仍可整步降级到原有 /move 接口。
    """
    return StateResponse(status=game_status(req.fen), legal_moves=legal_moves_uci(req.fen))


@router.post("/eval", response_model=EngineEvalResponse)
@limiter.limit("60/minute")
def eval_position(request: Request, req: EvalRequest):
    """评估给定局面的优劣势（红方视角），供对弈界面的评估条按需调用。"""
    from app.engine.pikafish import get_shared_engine

    engine = get_shared_engine()
    if engine is not None:
        result = engine.analyze(
            req.fen, depth=req.depth, mode=req.mode, value=req.value,
            multipv=req.multipv, show_wdl=req.show_wdl, search_moves=req.search_moves,
        )
        sign = 1 if side_to_move(req.fen) == "w" else -1
        return response_from_result(result, sign)
    e = evaluate_position(req.fen)
    return EngineEvalResponse(cp=e["cp"], mate=e["mate"])


@router.post("/eval/stream")
@limiter.limit("30/minute")
def stream_eval_position(request: Request, req: EvalRequest):
    from app.engine.pikafish import get_shared_engine

    engine = get_shared_engine()
    if engine is None:
        e = evaluate_position(req.fen)
        data = json.dumps({"type": "complete", "data": {"cp": e["cp"], "mate": e["mate"]}}) + "\n"
        return StreamingResponse(iter([data]), media_type="application/x-ndjson")
    return stream_engine(engine, req, 1 if side_to_move(req.fen) == "w" else -1)


@router.get("/engine", response_model=EngineResponse)
def engine_info():
    """报告当前对弈/评分实际使用的引擎，供前端显示。"""
    from app.engine.pikafish import get_shared_engine

    eng = get_shared_engine()
    if eng is not None:
        import os

        name = os.path.basename(eng.path) if getattr(eng, "path", None) else "Pikafish"
        return EngineResponse(engine="pikafish", label=f"Pikafish（{name}）", available=True)
    return EngineResponse(engine="builtin", label="内置搜索引擎", available=False)


@router.get("/book", response_model=BookResponse)
@limiter.limit("60/minute")
def query_book(request: Request, fen: str = Query(max_length=FEN_MAX)):
    """查询当前局面的云库着法（含评分/胜率），供前端开局参考面板使用。

    后端代理外部云库：统一缓存、规避浏览器跨域限制。
    """
    moves = cloudbook.query_book(fen)
    if moves is None:
        return BookResponse(available=False, moves=[])
    return BookResponse(available=True, moves=[BookMove(**m) for m in moves])


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


@router.post("/coach", response_model=CoachResponse)
@limiter.limit("10/minute")
def coach(
    request: Request,
    req: CoachRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """AI 教练点评一步推荐着法的意图，供「提示」面板的「AI 详解」按钮调用。

    需登录；PRO 已包含，免费账号按次消耗积分。
    """
    if req.move not in legal_moves_uci(req.fen):
        raise HTTPException(400, "不合规则的着法")
    if not get_llm_config(db).active:
        return CoachResponse(enabled=False, text="")
    if not credits.charge(db, user.username, "play_coach", "play"):
        raise HTTPException(
            402,
            f"免费账号本次 AI 走法点评需 {credits.cost(db, 'play_coach')} 积分；PRO 会员不限次。",
        )
    side = "红方" if side_to_move(req.fen) == "w" else "黑方"
    text = coach_move(req.fen, req.move, side, user_id=user.username, ref="play")
    if not text:
        credits.refund(db, user.username, "play_coach", "play")
    return CoachResponse(enabled=True, text=text)


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
