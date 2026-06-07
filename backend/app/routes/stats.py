"""统计接口：解决'是否在提升'的核心诉求。"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import Integer, func, select
from sqlalchemy.orm import Session

from ..auth import current_user_id
from ..deps import get_db
from ..models import Attempt, Puzzle, Review

router = APIRouter(prefix="/api/stats", tags=["stats"])


class Overview(BaseModel):
    total_puzzles: int
    learned: int            # 已有复习记录的题数
    due_today: int
    streak_days: int        # 连续打卡天数
    overall_accuracy: float # 总体首次正确率近似（按 attempts）


class CategoryStat(BaseModel):
    category: str
    attempts: int
    accuracy: float


class WeeklyPoint(BaseModel):
    week_start: date
    attempts: int
    accuracy: float


@router.get("/overview", response_model=Overview)
def overview(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    today = date.today()
    total = db.scalar(select(func.count()).select_from(Puzzle)) or 0
    learned = db.scalar(
        select(func.count()).select_from(Review).where(Review.user_id == user)
    ) or 0
    due = db.scalar(
        select(func.count())
        .select_from(Review)
        .where(Review.user_id == user, Review.next_review <= today)
    ) or 0

    total_att = db.scalar(
        select(func.count()).select_from(Attempt).where(Attempt.user_id == user)
    ) or 0
    correct_att = db.scalar(
        select(func.count())
        .select_from(Attempt)
        .where(Attempt.user_id == user, Attempt.correct.is_(True))
    ) or 0
    acc = round(correct_att / total_att, 3) if total_att else 0.0

    # 连续打卡：从今天往前逐日检查是否有作答
    days = {
        d for (d,) in db.execute(
            select(func.date(Attempt.ts)).where(Attempt.user_id == user).distinct()
        )
    }
    streak = 0
    cur = today
    while cur.isoformat() in days:
        streak += 1
        cur -= timedelta(days=1)

    return Overview(
        total_puzzles=total,
        learned=learned,
        due_today=due,
        streak_days=streak,
        overall_accuracy=acc,
    )


@router.get("/by_category", response_model=list[CategoryStat])
def by_category(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    """各杀法类型正确率 —— 一眼看出弱点（前端画雷达图）。"""
    rows = db.execute(
        select(
            Puzzle.category,
            func.count(Attempt.id),
            func.sum(func.cast(Attempt.correct, Integer)),
        )
        .join(Attempt, Attempt.puzzle_id == Puzzle.id)
        .where(Attempt.user_id == user)
        .group_by(Puzzle.category)
    ).all()
    out = []
    for cat, n, c in rows:
        c = c or 0
        out.append(CategoryStat(category=cat, attempts=n, accuracy=round(c / n, 3) if n else 0.0))
    return sorted(out, key=lambda x: x.accuracy)


@router.get("/weekly", response_model=list[WeeklyPoint])
def weekly(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    """按周的正确率趋势（最近 8 周）。"""
    since = date.today() - timedelta(weeks=8)
    rows = db.execute(
        select(Attempt.ts, Attempt.correct)
        .where(Attempt.user_id == user, func.date(Attempt.ts) >= since.isoformat())
    ).all()

    buckets: dict[date, list[int]] = {}
    for ts, correct in rows:
        d = ts.date() if hasattr(ts, "date") else date.fromisoformat(str(ts)[:10])
        wk = d - timedelta(days=d.weekday())  # 周一
        buckets.setdefault(wk, []).append(1 if correct else 0)

    return [
        WeeklyPoint(
            week_start=wk,
            attempts=len(v),
            accuracy=round(sum(v) / len(v), 3) if v else 0.0,
        )
        for wk, v in sorted(buckets.items())
    ]
