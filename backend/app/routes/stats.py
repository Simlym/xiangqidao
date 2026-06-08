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
    overall_accuracy: float # 总体正确率（按全部 attempts）
    first_try_accuracy: float  # 首答正确率（一次做对、未中途重试）


class CategoryStat(BaseModel):
    category: str
    attempts: int
    accuracy: float


class WeeklyPoint(BaseModel):
    week_start: date
    attempts: int
    accuracy: float


class ForecastPoint(BaseModel):
    day: date
    label: str      # 今天/明天/周几
    count: int      # 当天到期复习数
    overdue: bool    # 是否为已过期堆积（仅 day=today 那项可能为 True）


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

    # 首答正确率：一次做对且未中途重试
    first_try_att = db.scalar(
        select(func.count())
        .select_from(Attempt)
        .where(
            Attempt.user_id == user,
            Attempt.correct.is_(True),
            Attempt.had_retry.is_(False),
        )
    ) or 0
    first_acc = round(first_try_att / total_att, 3) if total_att else 0.0

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
        first_try_accuracy=first_acc,
    )


@router.get("/forecast", response_model=list[ForecastPoint])
def forecast(days: int = 14, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    """未来复习日程（间隔重复/遗忘曲线的可视化）：今后 N 天每天的到期复习量。

    今天那一格包含所有已过期（next_review <= today）的堆积量。
    """
    today = date.today()
    rows = db.execute(
        select(Review.next_review, func.count())
        .where(Review.user_id == user)
        .group_by(Review.next_review)
    ).all()

    counts: dict[date, int] = {}
    overdue = 0
    for nr, n in rows:
        d = nr if isinstance(nr, date) else date.fromisoformat(str(nr)[:10])
        if d <= today:
            overdue += n
        else:
            counts[d] = counts.get(d, 0) + n

    week = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    out: list[ForecastPoint] = []
    for i in range(days):
        d = today + timedelta(days=i)
        if i == 0:
            cnt, label, od = overdue, "今天", overdue > 0
        else:
            label = "明天" if i == 1 else week[d.weekday()]
            cnt, od = counts.get(d, 0), False
        out.append(ForecastPoint(day=d, label=label, count=cnt, overdue=od))
    return out


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
