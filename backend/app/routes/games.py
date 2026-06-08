"""棋局复盘路由。"""

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import current_user_id
from ..deps import get_db
from ..models import Game
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/games", tags=["games"])

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

UCI_RE = re.compile(r"^[a-i][0-9][a-i][0-9]$")


class ImportRequest(BaseModel):
    moves: str
    red_player: Optional[str] = ""
    black_player: Optional[str] = ""
    played_on: Optional[str] = None
    result: Optional[str] = "未知"
    opening: Optional[str] = ""
    source: Optional[str] = ""
    notes: Optional[str] = ""


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
def import_game(
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
    return {"id": game.id, "move_count": len(move_list)}


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
