"""训练相关接口：取到期题、逐步校验着法、最终提交自评。"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user_id
from ..deps import get_db
from ..models import Attempt, Puzzle, Review
from ..srs import SrsState, review as srs_review
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/training", tags=["training"])

QUALITY_MAP = {"again": 1, "hard": 3, "good": 4, "easy": 5}


# ── 数据模型 ────────────────────────────────────────────────────

class PuzzleOut(BaseModel):
    id: int
    fen: str
    side_to_move: str
    category: str
    difficulty: int
    total_steps: int  # 总步数，前端用于显示进度


class NextResponse(BaseModel):
    puzzle: PuzzleOut | None
    due_count: int


class CheckMoveRequest(BaseModel):
    puzzle_id: int
    step: int        # 0-based，第几步
    move: str        # 用户走的着法，UCI 坐标制


class CheckMoveResponse(BaseModel):
    correct: bool
    done: bool             # 所有步骤完成
    fen_after: str | None  # 走对时返回新局面（供前端继续显示）
    hint: str | None       # 答错时透露起点提示，如 "h2"（仅文件+行）


class SubmitRequest(BaseModel):
    puzzle_id: int
    self_rating: str       # again/hard/good/easy（答对完成后用户主动选）
    had_retry: bool = False
    time_spent_ms: int = 0
    # 答错放弃时 correct=False，此时 self_rating 固定为 again
    correct: bool = True


class SubmitResponse(BaseModel):
    next_review: date
    solution: list[str]    # 完整正解，供答错后展示讲解


# ── 接口 ───────────────────────────────────────────────────────

@router.get("/next", response_model=NextResponse)
def next_puzzle(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    """返回到期题或新题。"""
    today = date.today()
    due_count = db.scalar(
        select(func.count())
        .select_from(Review)
        .where(Review.user_id == user, Review.next_review <= today)
    ) or 0

    puzzle = db.scalar(
        select(Puzzle)
        .join(Review, Review.puzzle_id == Puzzle.id)
        .where(Review.user_id == user, Review.next_review <= today)
        .order_by(Review.next_review)
        .limit(1)
    )
    if puzzle is None:
        learned = select(Review.puzzle_id).where(Review.user_id == user)
        puzzle = db.scalar(
            select(Puzzle).where(Puzzle.id.not_in(learned)).order_by(Puzzle.difficulty).limit(1)
        )

    if puzzle:
        steps = len([m for m in puzzle.solution.split(",") if m.strip()])
        p_out = PuzzleOut(
            id=puzzle.id,
            fen=puzzle.fen,
            side_to_move=puzzle.side_to_move,
            category=puzzle.category,
            difficulty=puzzle.difficulty,
            total_steps=steps,
        )
    else:
        p_out = None

    return NextResponse(puzzle=p_out, due_count=due_count)


@router.post("/check_move", response_model=CheckMoveResponse)
def check_move(req: CheckMoveRequest, db: Session = Depends(get_db)):
    """校验用户走的某一步是否正确，返回新局面 FEN（不写库）。"""
    puzzle = db.get(Puzzle, req.puzzle_id)
    if puzzle is None:
        raise HTTPException(404, "题目不存在")

    solution = [m.strip() for m in puzzle.solution.split(",") if m.strip()]
    if req.step >= len(solution):
        raise HTTPException(400, "step 超出解题步数")

    expected = solution[req.step]
    correct = req.move.strip() == expected

    if not correct:
        # 给起点提示（透露棋子所在文件+行，不透露目标）
        hint = expected[:2]
        return CheckMoveResponse(correct=False, done=False, fen_after=None, hint=hint)

    # 把本步及之前所有正解步骤依序应用到初始 FEN，得到新局面
    fen = puzzle.fen
    for mv in solution[: req.step + 1]:
        fen = apply_move(fen, mv)

    done = req.step == len(solution) - 1
    return CheckMoveResponse(correct=True, done=done, fen_after=fen, hint=None)


@router.post("/submit", response_model=SubmitResponse)
def submit(req: SubmitRequest, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    """记录本次作答结果（含自评），更新 SM-2。"""
    puzzle = db.get(Puzzle, req.puzzle_id)
    if puzzle is None:
        raise HTTPException(404, "题目不存在")

    solution = [m.strip() for m in puzzle.solution.split(",") if m.strip()]

    rev = db.scalar(
        select(Review).where(Review.puzzle_id == puzzle.id, Review.user_id == user)
    )
    if rev is None:
        rev = Review(puzzle_id=puzzle.id, user_id=user)
        db.add(rev)

    # 答错放弃强制 again；答对但中途重试则自评最多降到 hard
    if not req.correct:
        quality = QUALITY_MAP["again"]
    elif req.had_retry and req.self_rating in ("good", "easy"):
        quality = QUALITY_MAP["hard"]
    else:
        quality = QUALITY_MAP.get(req.self_rating, 4)

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
            user_id=user,
            correct=req.correct,
            time_spent_ms=req.time_spent_ms,
        )
    )
    db.commit()

    return SubmitResponse(next_review=rev.next_review, solution=solution)
