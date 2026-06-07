"""训练相关接口：取到期题、提交作答。"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Attempt, Puzzle, Review
from ..srs import SrsState, review as srs_review

router = APIRouter(prefix="/api/training", tags=["training"])

USER = "default"

# 四档自评 -> SM-2 quality
QUALITY_MAP = {"again": 1, "hard": 3, "good": 4, "easy": 5}


class PuzzleOut(BaseModel):
    id: int
    fen: str
    side_to_move: str
    category: str
    difficulty: int
    # 注意：不返回 solution，避免前端泄题


class NextResponse(BaseModel):
    puzzle: PuzzleOut | None
    due_count: int


@router.get("/next", response_model=NextResponse)
def next_puzzle(db: Session = Depends(get_db)):
    """返回一道到期（next_review <= 今天）的题；没有到期题则返回一道未学过的新题。"""
    today = date.today()
    due_count = db.scalar(
        select(func.count())
        .select_from(Review)
        .where(Review.user_id == USER, Review.next_review <= today)
    ) or 0

    # 优先到期题
    stmt = (
        select(Puzzle)
        .join(Review, Review.puzzle_id == Puzzle.id)
        .where(Review.user_id == USER, Review.next_review <= today)
        .order_by(Review.next_review)
        .limit(1)
    )
    puzzle = db.scalar(stmt)

    # 没有到期题，取一道还没有 review 记录的新题
    if puzzle is None:
        learned = select(Review.puzzle_id).where(Review.user_id == USER)
        puzzle = db.scalar(
            select(Puzzle).where(Puzzle.id.not_in(learned)).order_by(Puzzle.difficulty).limit(1)
        )

    return NextResponse(
        puzzle=PuzzleOut.model_validate(puzzle, from_attributes=True) if puzzle else None,
        due_count=due_count,
    )


class SubmitRequest(BaseModel):
    puzzle_id: int
    move: str               # 用户走的着法，UCI 坐标制
    time_spent_ms: int = 0
    self_rating: str | None = None  # again/hard/good/easy；答错时忽略


class SubmitResponse(BaseModel):
    correct: bool
    solution: list[str]     # 完整正解，便于答错后讲解
    next_review: date


@router.post("/submit", response_model=SubmitResponse)
def submit(req: SubmitRequest, db: Session = Depends(get_db)):
    puzzle = db.get(Puzzle, req.puzzle_id)
    if puzzle is None:
        raise HTTPException(404, "题目不存在")

    solution = [m.strip() for m in puzzle.solution.split(",") if m.strip()]
    correct = bool(solution) and req.move.strip() == solution[0]

    # 取或建 Review
    rev = db.scalar(
        select(Review).where(Review.puzzle_id == puzzle.id, Review.user_id == USER)
    )
    if rev is None:
        rev = Review(puzzle_id=puzzle.id, user_id=USER)
        db.add(rev)

    # 质量评分：答对用自评，答错强制 again
    if correct:
        quality = QUALITY_MAP.get(req.self_rating or "good", 4)
    else:
        quality = QUALITY_MAP["again"]

    state = SrsState(
        repetitions=rev.repetitions or 0,
        interval=rev.interval or 0,
        ease_factor=rev.ease_factor or 2.5,
        next_review=rev.next_review,
    )
    new = srs_review(state, quality)
    rev.repetitions = new.repetitions
    rev.interval = new.interval
    rev.ease_factor = new.ease_factor
    rev.next_review = new.next_review

    db.add(
        Attempt(
            puzzle_id=puzzle.id,
            user_id=USER,
            correct=correct,
            time_spent_ms=req.time_spent_ms,
            wrong_move="" if correct else req.move.strip(),
        )
    )
    db.commit()

    return SubmitResponse(correct=correct, solution=solution, next_review=rev.next_review)
