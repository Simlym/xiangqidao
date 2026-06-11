"""棋局复盘路由。"""

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import credits
from ..auth import current_user_id
from ..deps import get_db
from ..models import Game
from ..ratelimit import limiter
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/games", tags=["games"])

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

UCI_RE = re.compile(r"^[a-i][0-9][a-i][0-9]$")

# 一着 5 字符（4 着法 + 分隔），上限约对应数千手，足够任何真实对局
_MOVES_MAX = 8000


class ImportRequest(BaseModel):
    moves: str = Field(max_length=_MOVES_MAX)
    red_player: Optional[str] = Field(default="", max_length=40)
    black_player: Optional[str] = Field(default="", max_length=40)
    played_on: Optional[str] = Field(default=None, max_length=40)
    result: Optional[str] = Field(default="未知", max_length=20)
    opening: Optional[str] = Field(default="", max_length=80)
    source: Optional[str] = Field(default="", max_length=80)
    notes: Optional[str] = Field(default="", max_length=2000)


class GameSummary(BaseModel):
    id: int
    played_on: Optional[str]
    red_player: str
    black_player: str
    result: str
    opening: str
    source: str

    model_config = {"from_attributes": True}


class Position(BaseModel):
    move_index: int
    move: str
    fen: str


class GameDetail(BaseModel):
    id: int
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


@router.get("", response_model=List[GameSummary])
def list_games(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    games = (
        db.query(Game)
        .filter(Game.user_id == user)
        .order_by(Game.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return games


@router.post("/import")
@limiter.limit("30/minute")
def import_game(
    request: Request,
    body: ImportRequest,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    # Normalize separator
    raw = body.moves.replace(",", " ").split()
    move_list = [m.strip() for m in raw if m.strip()]

    for m in move_list:
        if not UCI_RE.match(m):
            raise HTTPException(status_code=400, detail=f"非法着法格式: {m!r}，需要4字符UCI如h2e2")

    game = Game(
        user_id=user,
        moves=" ".join(move_list),
        red_player=body.red_player or "",
        black_player=body.black_player or "",
        played_on=body.played_on,
        result=body.result or "未知",
        opening=body.opening or "",
        source=body.source or "",
        notes=body.notes or "",
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    # 完成一局有效对弈奖励积分（登录用户、达到最小手数、每日封顶，防刷）
    awarded = credits.award_game(db, user, len(move_list), f"game:{game.id}")
    return {"id": game.id, "move_count": len(move_list), "credits_awarded": awarded}


@router.get("/{game_id}", response_model=GameDetail)
def get_game(
    game_id: int,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    game = db.get(Game, game_id)
    if not game or game.user_id != user:
        raise HTTPException(status_code=404, detail="棋局不存在")

    move_list = game.moves.split() if game.moves.strip() else []
    positions: List[Position] = [Position(move_index=0, move="", fen=INITIAL_FEN)]

    fen = INITIAL_FEN
    for i, m in enumerate(move_list, start=1):
        fen = apply_move(fen, m)
        positions.append(Position(move_index=i, move=m, fen=fen))

    return GameDetail(
        id=game.id,
        played_on=game.played_on,
        red_player=game.red_player,
        black_player=game.black_player,
        result=game.result,
        opening=game.opening,
        source=game.source,
        notes=game.notes,
        moves=game.moves,
        report=game.report or "",
        positions=positions,
    )


@router.delete("/{game_id}")
def delete_game(
    game_id: int,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    game = db.get(Game, game_id)
    if not game or game.user_id != user:
        raise HTTPException(status_code=404, detail="棋局不存在")
    db.delete(game)
    db.commit()
    return {"ok": True}
