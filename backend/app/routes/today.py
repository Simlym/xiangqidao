"""今日计划：把复习、实战错题、待复盘与下一步行动收束为一个入口。"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import elo, repository as repo
from ..auth import current_user_id
from ..deps import get_db
from ..models import Game, GameAnalysis
from .training import NEW_PER_DAY

router = APIRouter(prefix="/api/today", tags=["today"])


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


@router.get("", response_model=TodayPlan)
def today_plan(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    today = date.today()
    due = repo.count_due(db, user, today)
    new_remaining = max(0, NEW_PER_DAY - repo.count_new_today(db, user, today))
    blunders = repo.count_pending_private_puzzles(db, user)
    analyzed_games = select(GameAnalysis.game_id).distinct()
    pending_games = db.scalar(
        select(func.count()).select_from(Game).where(
            Game.user_id == user,
            Game.id.not_in(analyzed_games),
            Game.moves != "",
        )
    ) or 0

    days = repo.attempt_dates(db, user)
    streak = 0
    cursor = today
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)

    stat = repo.get_user_stat(db, user)
    rating = stat.rating if stat else 1200
    first_total, first_correct = repo.first_attempt_totals(db, user)

    actions: list[TodayAction] = []
    if due:
        actions.append(TodayAction(
            type="train", label="完成到期复习", count=due,
            detail="先巩固到期题，避免遗忘曲线积压。",
        ))
    if blunders:
        actions.append(TodayAction(
            type="category", category="实战漏算", label="重练实战错题", count=blunders,
            detail="这些局面来自你的真实对局，优先级最高。",
        ))
    if pending_games:
        actions.append(TodayAction(
            type="games", label="复盘待分析棋局", count=pending_games,
            detail="找出关键失误，再把漏着转成训练。",
        ))
    if not due and not blunders:
        actions.append(TodayAction(
            type="train", label="学习今日新题", count=new_remaining,
            detail="按当前水平自动选择合适难度。",
        ))
    actions.append(TodayAction(
        type="play", label="下一盘实战", detail="用一盘完整对局检验今天的训练。",
    ))

    return TodayPlan(
        due_reviews=due,
        new_remaining=new_remaining,
        pending_blunders=blunders,
        pending_games=pending_games,
        streak_days=streak,
        rating=rating,
        title=elo.rank_title(rating),
        first_try_accuracy=round(first_correct / first_total, 3) if first_total else 0.0,
        actions=actions,
    )
