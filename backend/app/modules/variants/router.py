"""多棋类公共接口。"""

from fastapi import APIRouter, HTTPException, Request

from app.engine.contract import EngineEvalRequest, EngineEvalResponse, response_from_result, stream_engine
from app.engine.jieqi import get_shared_jieqi_engine
from app.core.rate_limit import limiter

router = APIRouter(prefix="/api/variants", tags=["variants"])


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
    return response_from_result(result, sign)


@router.post("/jieqi/eval/stream")
@limiter.limit("30/minute")
def stream_jieqi(request: Request, req: EngineEvalRequest):
    engine = get_shared_jieqi_engine()
    if engine is None:
        raise HTTPException(503, "服务器尚未配置揭棋 Pikafish")
    return stream_engine(engine, req, 1 if req.fen.split()[1] == "w" else -1)
