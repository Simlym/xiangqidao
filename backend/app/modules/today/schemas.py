"""今日计划接口的请求与响应结构。"""

from pydantic import BaseModel


class TodayAction(BaseModel):
    type: str
    label: str
    detail: str
    count: int = 0
    category: str | None = None


class TodayPlan(BaseModel):
    due_reviews: int
    new_remaining: int
    pending_blunders: int
    pending_games: int
    streak_days: int
    rating: int
    title: str
    first_try_accuracy: float
    actions: list[TodayAction]
