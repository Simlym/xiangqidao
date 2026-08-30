"""多棋类公共接口。"""

import json
import queue
import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..jieqi_engine import get_shared_jieqi_engine
from ..ratelimit import limiter

router = APIRouter(prefix="/api/variants", tags=["variants"])


class EngineEvalRequest(BaseModel):
    fen: str = Field(max_length=240)
    depth: int = Field(default=12, ge=1, le=30)
    mode: str = Field(default="depth", pattern="^(depth|movetime|infinite)$")
    value: int | None = Field(default=None, ge=1, le=60000)
    multipv: int = Field(default=1, ge=1, le=10)
    show_wdl: bool = False
    search_moves: list[str] = Field(default_factory=list, max_length=20)


class EngineLine(BaseModel):
    multipv: int = 1
    depth: int | None = None
    seldepth: int | None = None
    score_cp: int | None = None
    score_mate: int | None = None
    pv: list[str] | None = None
    nodes: int | None = None
    nps: int | None = None
    time_ms: int | None = None
    wdl: tuple[int, int, int] | None = None


class EngineEvalResponse(BaseModel):
    cp: int | None = None
    mate: int | None = None
    best_move: str | None = None
    pv: list[str] | None = None
    depth: int | None = None
    seldepth: int | None = None
    nodes: int | None = None
    nps: int | None = None
    time_ms: int | None = None
    wdl: tuple[int, int, int] | None = None
    lines: list[EngineLine] | None = None


def _red_line(line: dict, sign: int) -> dict:
    next_line = {**line}
    if next_line.get("score_cp") is not None:
        next_line["score_cp"] *= sign
    if next_line.get("score_mate") is not None:
        next_line["score_mate"] *= sign
    if next_line.get("wdl") and sign == -1:
        win, draw, loss = next_line["wdl"]
        next_line["wdl"] = (loss, draw, win)
    return next_line


def _line_payload(line: dict, sign: int) -> dict:
    item = _red_line(line, sign)
    return {
        "cp": item.get("score_cp"), "mate": item.get("score_mate"),
        "best_move": (item.get("pv") or [None])[0], "pv": item.get("pv"),
        "depth": item.get("depth"), "seldepth": item.get("seldepth"),
        "nodes": item.get("nodes"), "nps": item.get("nps"),
        "time_ms": item.get("time_ms"), "wdl": item.get("wdl"),
        "lines": [item],
    }


@router.post("/jieqi/eval", response_model=EngineEvalResponse)
@limiter.limit("60/minute")
def evaluate_jieqi(request: Request, req: EngineEvalRequest):
    engine = get_shared_jieqi_engine()
    if engine is None:
        raise HTTPException(503, "服务器尚未配置揭棋 Pikafish，请管理员前往“管理后台 → 系统设置 → 揭棋引擎”配置")
    advanced = req.mode != "depth" or req.value is not None or req.multipv != 1 or req.show_wdl or req.search_moves
    result = engine.analyze(
        req.fen, depth=req.depth, **({
            "mode": req.mode, "value": req.value, "multipv": req.multipv,
            "show_wdl": req.show_wdl, "search_moves": req.search_moves,
        } if advanced else {})
    )
    sign = 1 if req.fen.split()[1] == "w" else -1
    wdl = getattr(result, "wdl", None)
    if wdl and sign == -1:
        wdl = (wdl[2], wdl[1], wdl[0])
    return EngineEvalResponse(
        cp=None if result.score_cp is None else sign * result.score_cp,
        mate=None if result.score_mate is None else sign * result.score_mate,
        best_move=result.best_move,
        pv=result.pv,
        depth=getattr(result, "depth", None), seldepth=getattr(result, "seldepth", None),
        nodes=getattr(result, "nodes", None), nps=getattr(result, "nps", None),
        time_ms=getattr(result, "time_ms", None), wdl=wdl,
        lines=[_red_line(line, sign) for line in (getattr(result, "lines", None) or [])],
    )


@router.post("/jieqi/eval/stream")
@limiter.limit("30/minute")
def stream_jieqi(request: Request, req: EngineEvalRequest):
    engine = get_shared_jieqi_engine()
    if engine is None:
        raise HTTPException(503, "服务器尚未配置揭棋 Pikafish")
    sign = 1 if req.fen.split()[1] == "w" else -1

    def generate():
        events: queue.Queue = queue.Queue()
        cancel = threading.Event()

        def run():
            try:
                result = engine.analyze(
                    req.fen, depth=req.depth, mode=req.mode, value=req.value,
                    multipv=req.multipv, show_wdl=req.show_wdl,
                    search_moves=req.search_moves, cancel_event=cancel,
                    on_info=lambda line: events.put(("info", _line_payload(line, sign))),
                )
                final = EngineEvalResponse(
                    cp=None if result.score_cp is None else sign * result.score_cp,
                    mate=None if result.score_mate is None else sign * result.score_mate,
                    best_move=result.best_move, pv=result.pv, depth=result.depth,
                    seldepth=result.seldepth, nodes=result.nodes, nps=result.nps,
                    time_ms=result.time_ms,
                    wdl=(result.wdl[2], result.wdl[1], result.wdl[0]) if result.wdl and sign == -1 else result.wdl,
                    lines=[_red_line(line, sign) for line in (result.lines or [])],
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
