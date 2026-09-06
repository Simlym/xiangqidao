"""AI 教练路由：读取/刷新个性化训练计划。"""

import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.modules.auth.service import current_user, current_user_id
from .schemas import PlanOut, PlanResponse, Rec
from .service import generate_plan
from app.core.dependencies import get_db
from app.core.models import CoachPlan, User
from app.core.rate_limit import limiter
from app.core.settings import get_llm_config

router = APIRouter(prefix="/api/coach", tags=["coach"])


def _to_out(plan: CoachPlan) -> PlanOut:
    recs = json.loads(plan.recommendations_json or "[]")
    profile = json.loads(plan.profile_json or "{}")
    progress = json.loads(plan.progress_json) if (plan.progress_json or "").strip() else None
    return PlanOut(
        id=plan.id,
        created_at=plan.created_at,
        trigger=plan.trigger,
        plan_text=plan.plan_text or "",
        recommendations=[Rec(**r) for r in recs],
        profile=profile,
        progress=progress,
    )


@router.get("/plan", response_model=PlanResponse)
def latest_plan(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    """最近一份训练计划（对局分析后自动生成，或手动刷新生成）。"""
    plan = (
        db.query(CoachPlan)
        .filter(CoachPlan.user_id == user)
        .order_by(CoachPlan.id.desc())
        .first()
    )
    return PlanResponse(
        plan=_to_out(plan) if plan else None,
        llm_enabled=get_llm_config(db).active,
    )


@router.post("/plan", response_model=PlanResponse)
@limiter.limit("5/minute")
def refresh_plan(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """按当前数据重新生成训练计划（LLM 可用时附教练叙述，调用较慢）。

    需登录；PRO 已包含，免费账号启用大模型时按次消耗积分。
    """
    # 积分不足时 generate_plan 自动降级为纯数据计划，基础教练能力始终可用。
    plan = generate_plan(db, user.username, trigger="manual")
    return PlanResponse(plan=_to_out(plan), llm_enabled=get_llm_config(db).active)
