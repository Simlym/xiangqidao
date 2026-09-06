"""闯关接口的数据契约。"""

from pydantic import BaseModel


class LevelPuzzle(BaseModel):
    id: int
    fen: str
    side_to_move: str
    category: str
    difficulty: int
    total_steps: int
    solved: bool       # 本用户是否已做对过
    session_id: str


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
    session_id: str
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
