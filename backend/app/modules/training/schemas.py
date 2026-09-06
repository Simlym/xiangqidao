"""训练 HTTP 接口的数据契约。"""

from datetime import date

from pydantic import BaseModel


class PuzzleOut(BaseModel):
    id: int
    fen: str
    side_to_move: str
    kind: str
    category: str
    difficulty: int
    total_steps: int
    session_id: str


class NextResponse(BaseModel):
    puzzle: PuzzleOut | None
    due_count: int
    new_limit_reached: bool = False


class CheckMoveRequest(BaseModel):
    puzzle_id: int
    session_id: str
    step: int
    move: str
    attempt: int = 0


class CheckMoveResponse(BaseModel):
    correct: bool
    done: bool
    fen_after: str | None
    hint: str | None
    opponent_move: str | None = None


class SubmitRequest(BaseModel):
    puzzle_id: int
    session_id: str
    self_rating: str
    had_retry: bool = False
    time_spent_ms: int = 0
    correct: bool = True


class RatingChange(BaseModel):
    old: int
    new: int
    delta: int


class SubmitResponse(BaseModel):
    next_review: date
    solution: list[str]
    rating: RatingChange | None = None
    rule_explanation: str = ""


class ExplainRequest(BaseModel):
    puzzle_id: int


class ExplainResponse(BaseModel):
    enabled: bool
    explanation: str
    cached: bool = False
    mode: str = "rules"
