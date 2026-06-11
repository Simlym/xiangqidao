"""AI 教练路由：读取/刷新个性化训练计划。"""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import credits
from ..auth import current_user, current_user_id
from ..coach import generate_plan
from ..deps import get_db
from ..models import CoachPlan, User
from ..ratelimit import limiter
from ..settings import get_deepseek_config

router = APIRouter(prefix="/api/coach", tags=["coach"])


class Rec(BaseModel):
    type: str                  # review / category / play / train
    category: str | None = None
    count: int | None = None
    reason: str = ""


class PlanOut(BaseModel):
    id: int
    created_at: datetime
    trigger: str               # manual / game:<id>
    plan_text: str             # LLM 教练叙述（未启用大模型时为空）
    recommendations: list[Rec]
    profile: dict              # 生成计划时的画像快照（水平/弱点等）
    progress: dict | None      # 与历史基线的进步对比（无历史时为 None）


class PlanResponse(BaseModel):
    plan: PlanOut | None
    llm_enabled: bool


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
        llm_enabled=get_deepseek_config(db).active,
    )


@router.post("/plan", response_model=PlanResponse)
@limiter.limit("5/minute")
def refresh_plan(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """按当前数据重新生成训练计划（LLM 可用时附教练叙述，调用较慢）。

    需登录；启用大模型时消耗积分（积分不足则提示，纯数据计划仍可在 GET 看到）。
    """
    if get_deepseek_config(db).active and not credits.can_afford(db, user.username, "coach_plan"):
        raise HTTPException(
            402,
            f"积分不足，生成 AI 教练计划需 {credits.cost(db, 'coach_plan')} 积分。"
            "可通过签到、对弈、做题获取积分。",
        )
    plan = generate_plan(db, user.username, trigger="manual")
    return PlanResponse(plan=_to_out(plan), llm_enabled=get_deepseek_config(db).active)
