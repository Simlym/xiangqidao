"""人机对弈接口的请求与响应结构。"""

from pydantic import BaseModel, Field

from app.engine.contract import EngineEvalRequest

# 合法象棋 FEN 不会超过约 90 字符，限长防超大串拖垮引擎/解析
FEN_MAX = 120


class NewGameRequest(BaseModel):
    human_side: str = "w"   # w=红（先手） b=黑
    level: str = "medium"   # easy / medium / hard


class NewGameResponse(BaseModel):
    fen: str
    engine_move: str | None  # 人执黑时引擎（红）先走一步
    status: str
    legal_moves: list[str]


class MoveRequest(BaseModel):
    fen: str = Field(max_length=FEN_MAX)
    move: str = Field(max_length=5)
    level: str = "medium"


class MoveResponse(BaseModel):
    fen: str               # 人走子（及引擎应着）后的最新局面
    engine_move: str | None
    status: str            # 轮到人时的局面状态
    legal_moves: list[str]
    your_turn: bool
    game_over: bool
    winner: str | None     # "human" / "engine" / "draw" / None


class EvalRequest(EngineEvalRequest):
    fen: str = Field(max_length=FEN_MAX)


class StateRequest(BaseModel):
    fen: str = Field(max_length=FEN_MAX)


class StateResponse(BaseModel):
    status: str
    legal_moves: list[str]


class EngineResponse(BaseModel):
    engine: str       # "uci" / "builtin"
    label: str        # 展示用名称
    available: bool   # 是否配置了用户提供的 UCI 引擎


class BookMove(BaseModel):
    uci: str
    score: int | None = None    # 走子方视角 centipawn
    rank: int | None = None     # 云库推荐等级（越大越优）
    winrate: float | None = None
    note: str | None = None


class BookResponse(BaseModel):
    available: bool          # 云库是否可用（关闭/网络异常时 False）
    moves: list[BookMove]


class HintRequest(BaseModel):
    fen: str = Field(max_length=FEN_MAX)


class HintResponse(BaseModel):
    move: str | None
    source: str  # "book" / "engine"


class CoachRequest(BaseModel):
    fen: str = Field(max_length=FEN_MAX)
    move: str = Field(max_length=5)


class CoachResponse(BaseModel):
    enabled: bool   # AI 点评是否可用（未配置 key 时 False）
    text: str
