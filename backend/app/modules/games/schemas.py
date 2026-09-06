"""棋局复盘接口的请求与响应结构。"""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

# 一着 5 字符（4 着法 + 分隔），上限约对应数千手，足够任何真实对局
_MOVES_MAX = 8000


class ImportRequest(BaseModel):
    variant: str = Field(default="xiangqi", pattern="^(xiangqi|jieqi)$")
    moves: str = Field(max_length=_MOVES_MAX)
    initial_fen: str = Field(default="", max_length=240)
    positions: list[str] = Field(default_factory=list, max_length=2000)
    red_player: Optional[str] = Field(default="", max_length=40)
    black_player: Optional[str] = Field(default="", max_length=40)
    played_on: Optional[str] = Field(default=None, max_length=40)
    result: Optional[str] = Field(default="未知", max_length=20)
    opening: Optional[str] = Field(default="", max_length=80)
    source: Optional[str] = Field(default="", max_length=80)
    notes: Optional[str] = Field(default="", max_length=2000)

    @field_validator("positions")
    @classmethod
    def validate_positions(cls, positions: list[str]):
        if any(len(fen) > 240 for fen in positions):
            raise ValueError("局面 FEN 过长")
        return positions


class GameSummary(BaseModel):
    id: int
    variant: str
    played_on: Optional[str]
    red_player: str
    black_player: str
    result: str
    opening: str
    source: str
    move_count: int = 0  # 总手数，便于列表区分相似对局

    model_config = {"from_attributes": True}


class Position(BaseModel):
    move_index: int
    move: str
    fen: str


class GameDetail(BaseModel):
    id: int
    variant: str
    initial_fen: str
    played_on: Optional[str]
    red_player: str
    black_player: str
    result: str
    opening: str
    source: str
    notes: str
    moves: str
    report: str
    positions: List[Position]
