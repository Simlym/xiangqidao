"""AI 教练接口的请求与响应结构。"""

from datetime import datetime

from pydantic import BaseModel


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
