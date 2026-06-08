"""数据访问层（repository）。

将业务路由与具体 ORM 查询解耦：路由只表达「要什么数据」，
查询细节集中在此，便于复用、测试与日后更换存储实现。
当前已迁移 training / stats 两个路由；其余路由可逐步采用。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import Integer, func, select
from sqlalchemy.orm import Session

from .models import Attempt, Puzzle, Review

# ── 题目 / 复习 ──────────────────────────────────────────────────


def get_puzzle(db: Session, puzzle_id: int) -> Puzzle | None:
    return db.get(Puzzle, puzzle_id)


def count_due(db: Session, user: str, today: date) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Review)
        .where(Review.user_id == user, Review.next_review <= today)
    ) or 0


def first_due_puzzle(db: Session, user: str, today: date) -> Puzzle | None:
    return db.scalar(
        select(Puzzle)
        .join(Review, Review.puzzle_id == Puzzle.id)
        .where(Review.user_id == user, Review.next_review <= today)
        .order_by(Review.next_review)
        .limit(1)
    )


def count_new_today(db: Session, user: str, today: date) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Review)
        .where(Review.user_id == user, Review.created_at == today)
    ) or 0


def count_unlearned(db: Session, user: str) -> int:
    learned = select(Review.puzzle_id).where(Review.user_id == user)
    return db.scalar(
        select(func.count()).select_from(Puzzle).where(Puzzle.id.not_in(learned))
    ) or 0


def pick_new_puzzle(db: Session, user: str, target_difficulty: int) -> Puzzle | None:
    """选一道未学新题，难度优先贴近 target_difficulty。"""
    learned = select(Review.puzzle_id).where(Review.user_id == user)
    return db.scalar(
        select(Puzzle)
        .where(Puzzle.id.not_in(learned))
        .order_by(func.abs(Puzzle.difficulty - target_difficulty), Puzzle.difficulty)
        .limit(1)
    )


def get_review(db: Session, puzzle_id: int, user: str) -> Review | None:
    return db.scalar(
        select(Review).where(Review.puzzle_id == puzzle_id, Review.user_id == user)
    )


# ── 作答记录 ────────────────────────────────────────────────────


def recent_attempts(db: Session, user: str, limit: int) -> list[tuple[bool, bool]]:
    """最近 limit 次作答的 (correct, had_retry)，用于难度自适应。"""
    return db.execute(
        select(Attempt.correct, Attempt.had_retry)
        .where(Attempt.user_id == user)
        .order_by(Attempt.id.desc())
        .limit(limit)
    ).all()


def attempt_totals(db: Session, user: str) -> tuple[int, int, int]:
    """返回 (总作答数, 做对数, 首答对数)。"""
    total = db.scalar(
        select(func.count()).select_from(Attempt).where(Attempt.user_id == user)
    ) or 0
    correct = db.scalar(
        select(func.count()).select_from(Attempt)
        .where(Attempt.user_id == user, Attempt.correct.is_(True))
    ) or 0
    first_try = db.scalar(
        select(func.count()).select_from(Attempt)
        .where(Attempt.user_id == user, Attempt.correct.is_(True), Attempt.had_retry.is_(False))
    ) or 0
    return total, correct, first_try


def attempt_dates(db: Session, user: str) -> set[str]:
    """该用户有作答的日期集合（ISO 字符串），用于连续打卡。"""
    return {
        d for (d,) in db.execute(
            select(func.date(Attempt.ts)).where(Attempt.user_id == user).distinct()
        )
    }


def category_stats(db: Session, user: str) -> list[tuple[str, int, int | None]]:
    """各分类的 (category, 作答数, 做对数)。"""
    return db.execute(
        select(
            Puzzle.category,
            func.count(Attempt.id),
            func.sum(func.cast(Attempt.correct, Integer)),
        )
        .join(Attempt, Attempt.puzzle_id == Puzzle.id)
        .where(Attempt.user_id == user)
        .group_by(Puzzle.category)
    ).all()


def attempts_since(db: Session, user: str, since: date) -> list[tuple]:
    """since 之后的 (ts, correct)，用于每周趋势。"""
    return db.execute(
        select(Attempt.ts, Attempt.correct)
        .where(Attempt.user_id == user, func.date(Attempt.ts) >= since.isoformat())
    ).all()


def review_due_counts(db: Session, user: str) -> list[tuple]:
    """各到期日的复习数 (next_review, count)，用于复习日程预测。"""
    return db.execute(
        select(Review.next_review, func.count())
        .where(Review.user_id == user)
        .group_by(Review.next_review)
    ).all()


# ── 题库整体 ────────────────────────────────────────────────────


def count_puzzles(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Puzzle)) or 0


def count_reviews(db: Session, user: str) -> int:
    return db.scalar(
        select(func.count()).select_from(Review).where(Review.user_id == user)
    ) or 0
