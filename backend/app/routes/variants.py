"""多棋类公共接口。"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..jieqi_engine import get_shared_jieqi_engine
from ..ratelimit import limiter

router = APIRouter(prefix="/api/variants", tags=["variants"])


class EngineEvalRequest(BaseModel):
    fen: str = Field(max_length=240)
    depth: int = Field(default=12, ge=1, le=30)


class EngineEvalResponse(BaseModel):
    cp: int | None = None
    mate: int | None = None
    best_move: str | None = None
    pv: list[str] | None = None


@router.post("/jieqi/eval", response_model=EngineEvalResponse)
@limiter.limit("60/minute")
def evaluate_jieqi(request: Request, req: EngineEvalRequest):
    engine = get_shared_jieqi_engine()
    if engine is None:
        raise HTTPException(503, "服务器尚未配置揭棋 Pikafish")
    result = engine.analyze(req.fen, depth=req.depth)
    sign = 1 if req.fen.split()[1] == "w" else -1
    return EngineEvalResponse(
        cp=None if result.score_cp is None else sign * result.score_cp,
        mate=None if result.score_mate is None else sign * result.score_mate,
        best_move=result.best_move,
        pv=result.pv,
    )
