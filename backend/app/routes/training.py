"""训练相关接口：取到期题、逐步校验着法、最终提交自评。"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import ratings, repository as repo
from ..auth import current_user_id
from ..deps import get_db
from ..importer.verify_mate import FILES, parse_fen
from ..models import Attempt, Review
from ..play_engine import game_status, legal_moves_uci
from ..srs import SrsState, review as srs_review
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/training", tags=["training"])

QUALITY_MAP = {"again": 1, "hard": 3, "good": 4, "easy": 5}

# 每日新题上限：到期复习不受限，仅限制每天首次学习的新题数量，防止贪多嚼不烂
NEW_PER_DAY = 20


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
    new_limit_reached: bool = False  # 今日新题已达上限（非题库耗尽）


class CheckMoveRequest(BaseModel):
    puzzle_id: int
    step: int        # 0-based，第几步
    move: str        # 用户走的着法，UCI 坐标制
    attempt: int = 0  # 本步已错次数，用于分级提示（越大透露越多）


class CheckMoveResponse(BaseModel):
    correct: bool
    done: bool             # 所有步骤完成
    fen_after: str | None  # 走对时返回新局面（已含对方应着）
    hint: str | None       # 答错时的分级提示文案
    opponent_move: str | None = None  # 系统自动走出的对方应着（UCI），供前端展示


class SubmitRequest(BaseModel):
    puzzle_id: int
    self_rating: str       # again/hard/good/easy（答对完成后用户主动选）
    had_retry: bool = False
    time_spent_ms: int = 0
    # 答错放弃时 correct=False，此时 self_rating 固定为 again
    correct: bool = True


class RatingChange(BaseModel):
    old: int
    new: int
    delta: int


class SubmitResponse(BaseModel):
    next_review: date
    solution: list[str]    # 完整正解，供答错后展示讲解
    rating: RatingChange | None = None  # 首次遇题时的评分变化（已登录用户）


PIECE_NAMES = {
    "K": "帅", "A": "仕", "B": "相", "N": "马", "R": "车", "C": "炮", "P": "兵",
    "k": "将", "a": "士", "b": "象", "n": "马", "r": "车", "c": "炮", "p": "卒",
}


def _piece_name_at(fen: str, sq: str) -> str:
    """返回 UCI 方格 sq 处棋子的中文名，空格返回'棋子'。"""
    try:
        board = parse_fen(fen)
        col = FILES.index(sq[0])
        row = 9 - int(sq[1])  # verify_mate 内部 row0=rank9
        p = board[row][col]
        return PIECE_NAMES.get(p, "棋子") if p else "棋子"
    except Exception:
        return "棋子"


def _graded_hint(fen_now: str, expected: str, attempt: int) -> str:
    """分级提示：错得越多透露越多。
    1 次错→起点格；2 次错→起点棋子名；3 次及以上→完整正解。
    """
    start, target = expected[:2], expected[2:]
    if attempt <= 0:
        return f"该走的棋子在 {start}"
    name = _piece_name_at(fen_now, start)
    if attempt == 1:
        return f"动用 {start} 的{name}"
    return f"正解：{name} {start} → {target}"


def _target_difficulty(db: Session, user: str) -> int:
    """据最近表现估计合适难度（1-5）：首答正确率越高，难度目标越高。"""
    rows = repo.recent_attempts(db, user, limit=20)
    if len(rows) < 5:
        return 2  # 冷启动：偏易上手
    first_try = sum(1 for c, r in rows if c and not r)
    acc = first_try / len(rows)
    if acc >= 0.85:
        return 5
    if acc >= 0.70:
        return 4
    if acc >= 0.50:
        return 3
    if acc >= 0.30:
        return 2
    return 1


# ── 接口 ───────────────────────────────────────────────────────

def _puzzle_out(puzzle) -> PuzzleOut:
    n = len([m for m in puzzle.solution.split(",") if m.strip()])
    steps = (n + 1) // 2  # 仅玩家要走的着法数（对方应着自动走出）
    return PuzzleOut(
        id=puzzle.id,
        fen=puzzle.fen,
        side_to_move=puzzle.side_to_move,
        category=puzzle.category,
        difficulty=puzzle.difficulty,
        total_steps=steps,
    )


@router.get("/puzzle/{puzzle_id}", response_model=PuzzleOut)
def get_training_puzzle(
    puzzle_id: int,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    """按 id 取一道题用于训练（如从复盘报告/弱点跳转而来）。

    仅返回对该用户可见的题（公共题库 + 本人私有题），否则 404。
    """
    puzzle = repo.get_visible_puzzle(db, puzzle_id, user)
    if puzzle is None:
        raise HTTPException(404, "题目不存在")
    return _puzzle_out(puzzle)


@router.get("/next", response_model=NextResponse)
def next_puzzle(
    category: str | None = None,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    """返回到期题或新题。

    传入 category 时进入「弱点专项」模式：只在该杀法类目内取题，
    优先到期题、其次新题，并放宽每日新题上限（用户主动针对性练习）。
    """
    today = date.today()
    due_count = repo.count_due(db, user, today)

    new_limit_reached = False
    if category:
        puzzle = repo.first_due_puzzle(db, user, today, category) or repo.pick_new_puzzle(
            db, user, _target_difficulty(db, user), category
        )
    else:
        puzzle = repo.first_due_puzzle(db, user, today)
        if puzzle is None:
            # 无到期题才考虑新题，且受每日新题上限约束
            if repo.count_new_today(db, user, today) < NEW_PER_DAY:
                # 难度自适应：优先选难度最接近目标的新题
                puzzle = repo.pick_new_puzzle(db, user, _target_difficulty(db, user))
                # 取不到说明题库已学完；取到则正常返回
            else:
                # 仍有未学新题但今日额度用尽时才算“达上限”
                new_limit_reached = repo.count_unlearned(db, user) > 0

    p_out = _puzzle_out(puzzle) if puzzle else None
    return NextResponse(puzzle=p_out, due_count=due_count, new_limit_reached=new_limit_reached)


@router.post("/check_move", response_model=CheckMoveResponse)
def check_move(req: CheckMoveRequest, db: Session = Depends(get_db)):
    """校验用户走的某一步是否正确，返回新局面 FEN（不写库）。"""
    puzzle = repo.get_puzzle(db, req.puzzle_id)
    if puzzle is None:
        raise HTTPException(404, "题目不存在")

    solution = [m.strip() for m in puzzle.solution.split(",") if m.strip()]
    n = len(solution)
    sol_idx = 2 * req.step  # 玩家第 step 步对应的 solution 下标（偶数位）
    if sol_idx >= n:
        raise HTTPException(400, "step 超出解题步数")

    expected = solution[sol_idx]
    user_move = req.move.strip()
    is_mating_move = sol_idx == n - 1  # 之后无对方应着，通常即终结(将死)的一手

    # 当前步之前的局面（已走完前面所有 己方+对方 着法）
    fen_now = puzzle.fen
    for mv in solution[:sol_idx]:
        fen_now = apply_move(fen_now, mv)

    correct = user_move == expected

    # 变着容错：仅终结步放宽——走出“另一条同样成立的杀着”也算对；
    # 中间步换着会让后续录入的对方应着无法衔接，故仍要求精确。
    if not correct and is_mating_move:
        try:
            if user_move in legal_moves_uci(fen_now):
                if game_status(apply_move(fen_now, user_move)) == "checkmate":
                    correct = True
        except Exception:
            pass

    if not correct:
        # 分级提示：随重试次数逐步透露更多
        hint = _graded_hint(fen_now, expected, req.attempt)
        return CheckMoveResponse(correct=False, done=False, fen_after=None, hint=hint)

    # 应用玩家这一手（终结步可能是等效变着）
    fen_after = apply_move(fen_now, user_move)

    # 自动走出对方应着（若有），让玩家只需关心己方着法
    opponent_move = None
    if sol_idx + 1 < n:
        opponent_move = solution[sol_idx + 1]
        try:
            fen_after = apply_move(fen_after, opponent_move)
        except Exception:
            opponent_move = None

    done = sol_idx + 2 >= n  # 没有下一玩家步即完成
    return CheckMoveResponse(
        correct=True, done=done, fen_after=fen_after, hint=None, opponent_move=opponent_move,
    )


@router.post("/submit", response_model=SubmitResponse)
def submit(req: SubmitRequest, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    """记录本次作答结果（含自评），更新 SM-2。"""
    puzzle = repo.get_puzzle(db, req.puzzle_id)
    if puzzle is None:
        raise HTTPException(404, "题目不存在")

    solution = [m.strip() for m in puzzle.solution.split(",") if m.strip()]

    # 评分只在首次遇题时结算（须在写入本次 Attempt 之前判定）
    rating_change = None
    if not repo.has_attempt(db, user, puzzle.id):
        rating_change = ratings.apply(
            db, user, puzzle, ratings.score_of(req.correct, req.had_retry)
        )

    rev = repo.get_review(db, puzzle.id, user)
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
            had_retry=req.had_retry,
        )
    )
    db.commit()

    rc = (
        RatingChange(old=rating_change["old"], new=rating_change["new"], delta=rating_change["delta"])
        if rating_change
        else None
    )
    return SubmitResponse(next_review=rev.next_review, solution=solution, rating=rc)
