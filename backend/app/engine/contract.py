"""面向各棋种的统一引擎 API 契约、红方视角转换与 NDJSON 流。"""

from __future__ import annotations

import json
import queue
import threading
from collections.abc import Iterator
from typing import Any

from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


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


def line_from_red_perspective(line: dict, sign: int) -> dict:
    """把引擎当前行棋方视角统一转换为红方视角。"""
    converted = {**line}
    if converted.get("score_cp") is not None:
        converted["score_cp"] *= sign
    if converted.get("score_mate") is not None:
        converted["score_mate"] *= sign
    if converted.get("wdl") and sign == -1:
        win, draw, loss = converted["wdl"]
        converted["wdl"] = (loss, draw, win)
    return converted


def response_from_result(result: Any, sign: int) -> EngineEvalResponse:
    wdl = getattr(result, "wdl", None)
    if wdl and sign == -1:
        wdl = (wdl[2], wdl[1], wdl[0])
    return EngineEvalResponse(
        cp=None if result.score_cp is None else sign * result.score_cp,
        mate=None if result.score_mate is None else sign * result.score_mate,
        best_move=result.best_move,
        pv=result.pv,
        depth=getattr(result, "depth", None),
        seldepth=getattr(result, "seldepth", None),
        nodes=getattr(result, "nodes", None),
        nps=getattr(result, "nps", None),
        time_ms=getattr(result, "time_ms", None),
        wdl=wdl,
        lines=[line_from_red_perspective(line, sign) for line in (getattr(result, "lines", None) or [])],
    )


def _line_payload(line: dict, sign: int) -> dict:
    item = line_from_red_perspective(line, sign)
    return {
        "cp": item.get("score_cp"), "mate": item.get("score_mate"),
        "best_move": (item.get("pv") or [None])[0], "pv": item.get("pv"),
        "depth": item.get("depth"), "seldepth": item.get("seldepth"),
        "nodes": item.get("nodes"), "nps": item.get("nps"),
        "time_ms": item.get("time_ms"), "wdl": item.get("wdl"), "lines": [item],
    }


def _event_stream(engine: Any, req: EngineEvalRequest, sign: int) -> Iterator[str]:
    events: queue.Queue = queue.Queue()
    cancel = threading.Event()

    def run() -> None:
        try:
            result = engine.analyze(
                req.fen, depth=req.depth, mode=req.mode, value=req.value,
                multipv=req.multipv, show_wdl=req.show_wdl,
                search_moves=req.search_moves, cancel_event=cancel,
                on_info=lambda line: events.put(("info", _line_payload(line, sign))),
            )
            events.put(("complete", response_from_result(result, sign).model_dump()))
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


def stream_engine(engine: Any, req: EngineEvalRequest, sign: int) -> StreamingResponse:
    return StreamingResponse(_event_stream(engine, req, sign), media_type="application/x-ndjson")
