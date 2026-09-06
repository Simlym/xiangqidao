"""管理员接口的请求与响应结构。"""

from datetime import datetime

from pydantic import BaseModel, Field


class AdminUser(BaseModel):
    id: int
    username: str
    role: str
    plan: str
    membership_expires_at: datetime | None
    attempts: int
    learned: int
    created_at: str
    last_login: str
    games: int
    rating: int | None
    credits: int
    checkin_streak: int


class AdminPuzzle(BaseModel):
    id: int
    fen: str
    solution: str
    side_to_move: str
    kind: str
    category: str
    difficulty: int
    steps: int
    source: str
    verified: bool
    tags: str


class MembershipUpdate(BaseModel):
    days: int = Field(ge=0, le=3650)


class AdminPuzzleList(BaseModel):
    total: int
    categories: list[str]
    items: list[AdminPuzzle]


class NewPuzzle(BaseModel):
    fen: str
    solution: str
    side_to_move: str = "w"
    kind: str = "杀法"
    category: str = "未分类"
    difficulty: int = 3
    source: str = "admin"
    tags: str = ""
    mate_check: bool = True


class AdminCreditLogRow(BaseModel):
    ts: str
    kind: str
    amount: int
    balance_after: int
    ref: str


class AdminCredits(BaseModel):
    username: str
    balance: int
    total_earned: int
    checkin_streak: int
    last_checkin: str
    logs: list[AdminCreditLogRow]


class CreditAdjustBody(BaseModel):
    delta: int
    reason: str = ""


class LlmSettings(BaseModel):
    enabled: bool
    protocol: str
    base_url: str
    model: str
    thinking_enabled: bool
    reasoning_effort: str
    has_key: bool
    key_hint: str
    active: bool


class LlmSettingsUpdate(BaseModel):
    enabled: bool | None = None
    protocol: str | None = None
    base_url: str | None = None
    model: str | None = None
    thinking_enabled: bool | None = None
    reasoning_effort: str | None = None
    api_key: str | None = None


class AdminLog(BaseModel):
    id: int
    ts: str
    level: str
    event: str
    ip: str
    actor: str
    action: str
    target: str
