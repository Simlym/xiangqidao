"""评分结算服务：把一次作答结果转换为用户与题目的 ELO 变化。

只在用户「首次遇到某题」时结算（调用方用 repo.has_attempt 判定），
避免间隔复习反复刷分。匿名访客（default）不结算，以免全网访客共用一份评分。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from . import elo, repository as repo
from .models import Puzzle

GUEST = "default"


def score_of(correct: bool, had_retry: bool) -> float:
    """作答结果 → ELO 得分：一次做对=1，重试后做对=0.5，未做出=0。"""
    if not correct:
        return 0.0
    return 0.5 if had_retry else 1.0


def apply(db: Session, user: str, puzzle: Puzzle, score: float) -> dict | None:
    """结算一次评分，返回 {old, new, delta, puzzle_rating}；不结算时返回 None。

    调用方负责在「首次遇题」时才调用本函数。会就地修改 user_stat 与 puzzle.rating，
    交由调用方统一 commit。
    """
    if user == GUEST:
        return None

    stat = repo.get_or_create_user_stat(db, user)
    pr = puzzle.rating if puzzle.rating is not None else elo.difficulty_to_rating(puzzle.difficulty)
    new_user, new_puzzle = elo.update_ratings(stat.rating, pr, score, stat.solved)

    old = stat.rating
    stat.rating = new_user
    stat.peak = max(stat.peak, new_user)
    stat.solved += 1
    stat.updated_at = datetime.utcnow()
    puzzle.rating = new_puzzle

    return {
        "old": old,
        "new": new_user,
        "delta": new_user - old,
        "puzzle_rating": new_puzzle,
    }
