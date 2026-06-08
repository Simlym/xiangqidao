"""闯关体系：把公共题库按难度切成依次解锁的关卡，给训练一条「线性进度」。

关卡是从公共题库按 (难度, id) 稳定排序后每 LEVEL_SIZE 题切一段而成——
题库增长时关卡自动延伸，无需额外维护。某关「通关」= 其中每题都至少做对过一次；
通关后解锁下一关。星级看本关一次做对的比例，鼓励重刷拿三星。

闯关复用训练的 check_move 逐步校验逻辑；本路由只负责关卡视图与结算（含 ELO）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import ratings, repository as repo
from ..auth import current_user_id
from ..deps import get_db
from ..models import Attempt

router = APIRouter(prefix="/api/challenge", tags=["challenge"])

LEVEL_SIZE = 6  # 每关题数


# ── 数据模型 ────────────────────────────────────────────────────

class LevelPuzzle(BaseModel):
    id: int
    fen: str
    side_to_move: str
    category: str
    difficulty: int
    total_steps: int
    solved: bool       # 本用户是否已做对过


class LevelOut(BaseModel):
    index: int
    title: str
    difficulty: int    # 本关代表难度（1-5）
    total: int
    solved: int        # 本关已做对题数
    cleared: bool
    unlocked: bool
    stars: int         # 0-3


class LevelDetail(BaseModel):
    index: int
    title: str
    difficulty: int
    unlocked: bool
    puzzles: list[LevelPuzzle]


class ChallengeSubmitRequest(BaseModel):
    puzzle_id: int
    correct: bool = True
    had_retry: bool = False
    time_spent_ms: int = 0


class RatingChange(BaseModel):
    old: int
    new: int
    delta: int


class ChallengeSubmitResponse(BaseModel):
    solution: list[str]
    solved: bool        # 本题是否判为做对
    rating: RatingChange | None = None


# ── 关卡切分 ────────────────────────────────────────────────────

def _chunks(puzzles: list) -> list[list]:
    return [puzzles[i : i + LEVEL_SIZE] for i in range(0, len(puzzles), LEVEL_SIZE)]


def _steps(puzzle) -> int:
    n = len([m for m in puzzle.solution.split(",") if m.strip()])
    return (n + 1) // 2


def _level_title(index: int) -> str:
    return f"第 {index + 1} 关"


# ── 接口 ───────────────────────────────────────────────────────

@router.get("/levels", response_model=list[LevelOut])
def list_levels(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    puzzles = repo.public_puzzles_ordered(db)
    solved_ids = repo.solved_puzzle_ids(db, user)
    first_ids = repo.first_try_puzzle_ids(db, user)

    out: list[LevelOut] = []
    prev_cleared = True  # 第一关默认解锁
    for idx, chunk in enumerate(_chunks(puzzles)):
        ids = [p.id for p in chunk]
        n_solved = sum(1 for i in ids if i in solved_ids)
        cleared = n_solved == len(ids)
        n_first = sum(1 for i in ids if i in first_ids)
        stars = 0
        if cleared:
            ratio = n_first / len(ids)
            stars = 3 if ratio >= 0.999 else 2 if ratio >= 0.66 else 1
        difficulty = chunk[len(chunk) // 2].difficulty
        out.append(
            LevelOut(
                index=idx,
                title=_level_title(idx),
                difficulty=difficulty,
                total=len(ids),
                solved=n_solved,
                cleared=cleared,
                unlocked=prev_cleared,
                stars=stars,
            )
        )
        prev_cleared = cleared
    return out


@router.get("/level/{index}", response_model=LevelDetail)
def get_level(index: int, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    chunks = _chunks(repo.public_puzzles_ordered(db))
    if index < 0 or index >= len(chunks):
        raise HTTPException(404, "关卡不存在")

    # 解锁校验：前一关必须通关
    solved_ids = repo.solved_puzzle_ids(db, user)
    unlocked = True
    if index > 0:
        prev_ids = [p.id for p in chunks[index - 1]]
        unlocked = all(i in solved_ids for i in prev_ids)
    if not unlocked:
        raise HTTPException(403, "请先通关前一关")

    chunk = chunks[index]
    puzzles = [
        LevelPuzzle(
            id=p.id,
            fen=p.fen,
            side_to_move=p.side_to_move,
            category=p.category,
            difficulty=p.difficulty,
            total_steps=_steps(p),
            solved=p.id in solved_ids,
        )
        for p in chunk
    ]
    return LevelDetail(
        index=index,
        title=_level_title(index),
        difficulty=chunk[len(chunk) // 2].difficulty,
        unlocked=True,
        puzzles=puzzles,
    )


@router.post("/submit", response_model=ChallengeSubmitResponse)
def submit(
    req: ChallengeSubmitRequest,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    """记录一次闯关作答：写 Attempt、首次遇题结算 ELO。不走 SM-2 调度。"""
    puzzle = repo.get_visible_puzzle(db, req.puzzle_id, user)
    if puzzle is None:
        raise HTTPException(404, "题目不存在")

    rating_change = None
    if not repo.has_attempt(db, user, puzzle.id):
        rating_change = ratings.apply(
            db, user, puzzle, ratings.score_of(req.correct, req.had_retry)
        )

    db.add(
        Attempt(
            puzzle_id=puzzle.id,
            user_id=user,
            correct=req.correct,
            time_spent_ms=req.time_spent_ms,
            had_retry=req.had_retry,
        )
    )
    db.commit()

    rc = (
        RatingChange(old=rating_change["old"], new=rating_change["new"], delta=rating_change["delta"])
        if rating_change
        else None
    )
    solution = [m.strip() for m in puzzle.solution.split(",") if m.strip()]
    return ChallengeSubmitResponse(solution=solution, solved=req.correct, rating=rc)
