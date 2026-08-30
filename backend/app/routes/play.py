"""人机对弈接口（无状态：局面 FEN 由前端持有）。"""

import json
import queue
import threading

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import cloudbook, credits
from ..auth import current_user
from ..deps import get_db
from ..llm import coach_move
from ..models import User
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
    depth: int = Field(default=12, ge=1, le=30)
    mode: str = Field(default="depth", pattern="^(depth|movetime|infinite)$")
    value: int | None = Field(default=None, ge=1, le=60000)
    multipv: int = Field(default=1, ge=1, le=10)
    show_wdl: bool = False
    search_moves: list[str] = Field(default_factory=list, max_length=20)


class EvalResponse(BaseModel):
    cp: int | None = None    # 红方视角 centipawn，正=红优、负=黑优
    mate: int | None = None  # 红方视角几步杀，正=红方可杀、负=黑方可杀
    best_move: str | None = None
    pv: list[str] | None = None
    depth: int | None = None
    seldepth: int | None = None
    nodes: int | None = None
    nps: int | None = None
    time_ms: int | None = None
    wdl: tuple[int, int, int] | None = None
    lines: list[dict] | None = None


class StateRequest(BaseModel):
    fen: str = Field(max_length=_FEN_MAX)


class StateResponse(BaseModel):
    status: str
    legal_moves: list[str]


@router.post("/state", response_model=StateResponse)
@limiter.limit("240/minute")
def position_state(request: Request, req: StateRequest):
    """只校验局面并返回合法着法，不启动引擎。

    PC/WASM 在本地计算引擎应着后通过该接口复用服务端权威棋规；计算失败时
    客户端仍可整步降级到原有 /move 接口。
    """
    return StateResponse(status=game_status(req.fen), legal_moves=legal_moves_uci(req.fen))


@router.post("/eval", response_model=EvalResponse)
@limiter.limit("60/minute")
def eval_position(request: Request, req: EvalRequest):
    """评估给定局面的优劣势（红方视角），供对弈界面的评估条按需调用。"""
    from ..engine import get_shared_engine

    engine = get_shared_engine()
    if engine is not None:
        result = engine.analyze(
            req.fen, depth=req.depth, mode=req.mode, value=req.value,
            multipv=req.multipv, show_wdl=req.show_wdl, search_moves=req.search_moves,
        )
        sign = 1 if side_to_move(req.fen) == "w" else -1
        def red_line(line):
            next_line = {**line}
            if next_line.get("score_cp") is not None:
                next_line["score_cp"] *= sign
            if next_line.get("score_mate") is not None:
                next_line["score_mate"] *= sign
            if next_line.get("wdl") and sign == -1:
                win, draw, loss = next_line["wdl"]
                next_line["wdl"] = (loss, draw, win)
            return next_line
        wdl = getattr(result, "wdl", None)
        if wdl and sign == -1:
            wdl = (wdl[2], wdl[1], wdl[0])
        return EvalResponse(
            cp=None if result.score_cp is None else sign * result.score_cp,
            mate=None if result.score_mate is None else sign * result.score_mate,
            best_move=result.best_move, pv=result.pv, depth=getattr(result, "depth", None),
            seldepth=getattr(result, "seldepth", None), nodes=getattr(result, "nodes", None),
            nps=getattr(result, "nps", None), time_ms=getattr(result, "time_ms", None), wdl=wdl,
            lines=[red_line(line) for line in (getattr(result, "lines", None) or [])],
        )
    e = evaluate_position(req.fen)
    return EvalResponse(cp=e["cp"], mate=e["mate"])


@router.post("/eval/stream")
@limiter.limit("30/minute")
def stream_eval_position(request: Request, req: EvalRequest):
    from ..engine import get_shared_engine

    engine = get_shared_engine()
    if engine is None:
        e = evaluate_position(req.fen)
        data = json.dumps({"type": "complete", "data": {"cp": e["cp"], "mate": e["mate"]}}) + "\n"
        return StreamingResponse(iter([data]), media_type="application/x-ndjson")
    sign = 1 if side_to_move(req.fen) == "w" else -1

    def red_line(line):
        item = {**line}
        if item.get("score_cp") is not None:
            item["score_cp"] *= sign
        if item.get("score_mate") is not None:
            item["score_mate"] *= sign
        if item.get("wdl") and sign == -1:
            win, draw, loss = item["wdl"]
            item["wdl"] = (loss, draw, win)
        return item

    def payload(line):
        item = red_line(line)
        return {
            "cp": item.get("score_cp"), "mate": item.get("score_mate"),
            "best_move": (item.get("pv") or [None])[0], "pv": item.get("pv"),
            "depth": item.get("depth"), "seldepth": item.get("seldepth"),
            "nodes": item.get("nodes"), "nps": item.get("nps"),
            "time_ms": item.get("time_ms"), "wdl": item.get("wdl"), "lines": [item],
        }

    def generate():
        events: queue.Queue = queue.Queue()
        cancel = threading.Event()

        def run():
            try:
                result = engine.analyze(
                    req.fen, depth=req.depth, mode=req.mode, value=req.value,
                    multipv=req.multipv, show_wdl=req.show_wdl,
                    search_moves=req.search_moves, cancel_event=cancel,
                    on_info=lambda line: events.put(("info", payload(line))),
                )
                wdl = result.wdl
                if wdl and sign == -1:
                    wdl = (wdl[2], wdl[1], wdl[0])
                final = EvalResponse(
                    cp=None if result.score_cp is None else sign * result.score_cp,
                    mate=None if result.score_mate is None else sign * result.score_mate,
                    best_move=result.best_move, pv=result.pv, depth=result.depth,
                    seldepth=result.seldepth, nodes=result.nodes, nps=result.nps,
                    time_ms=result.time_ms, wdl=wdl,
                    lines=[red_line(line) for line in (result.lines or [])],
                ).model_dump()
                events.put(("complete", final))
            except Exception as error:
                events.put(("error", {"message": str(error)}))

        threading.Thread(target=run, daemon=True).start()
        try:
            while True:
                event, data = events.get()
                yield json.dumps({"type": event, "data": data}, ensure_ascii=False) + "\n"
                if event in ("complete", "error"):
                    break
        finally:
            cancel.set()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


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
    if not get_deepseek_config(db).active:
        return CoachResponse(enabled=False, text="")
    if not credits.charge(db, user.username, "play_coach", "play"):
        raise HTTPException(
            402,
            f"免费账号本次 AI 走法点评需 {credits.cost(db, 'play_coach')} 积分；PRO 会员不限次。",
        )
    side = "红方" if side_to_move(req.fen) == "w" else "黑方"
    text = coach_move(req.fen, req.move, side)
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
