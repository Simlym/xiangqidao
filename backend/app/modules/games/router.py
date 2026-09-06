"""棋局复盘路由。"""

import json
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.modules.credits import service as credits
from app.modules.auth.service import current_user_id
from app.core.dependencies import get_db
from app.core.models import Game
from app.core.rate_limit import limiter
from app.shared.xiangqi import apply_move
from .schemas import GameDetail, GameSummary, ImportRequest, Position

router = APIRouter(prefix="/api/games", tags=["games"])

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

UCI_RE = re.compile(r"^[a-i][0-9][a-i][0-9][a-zA-Z]{0,2}$")


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
    return [
        GameSummary(
            id=g.id,
            variant=g.variant or "xiangqi",
            played_on=g.played_on,
            red_player=g.red_player,
            black_player=g.black_player,
            result=g.result,
            opening=g.opening,
            source=g.source,
            move_count=len(g.moves.split()) if g.moves and g.moves.strip() else 0,
        )
        for g in games
    ]


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
            raise HTTPException(status_code=400, detail=f"非法着法格式: {m!r}")
    if body.variant == "jieqi" and len(body.positions) != len(move_list) + 1:
        raise HTTPException(status_code=400, detail="揭棋棋谱必须携带每一步局面")

    game = Game(
        variant=body.variant,
        user_id=user,
        initial_fen=body.initial_fen or (INITIAL_FEN if body.variant == "xiangqi" else ""),
        positions_json=json.dumps(body.positions, ensure_ascii=False) if body.positions else "",
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
    if game.positions_json:
        try:
            stored = json.loads(game.positions_json)
        except (TypeError, json.JSONDecodeError):
            raise HTTPException(status_code=422, detail="棋谱局面数据已损坏")
        if not isinstance(stored, list) or len(stored) != len(move_list) + 1:
            raise HTTPException(status_code=422, detail="棋谱局面数据不完整")
        positions = [
            Position(move_index=index, move="" if index == 0 else move_list[index - 1], fen=fen)
            for index, fen in enumerate(stored)
        ]
    else:
        start_fen = game.initial_fen or INITIAL_FEN
        positions = [Position(move_index=0, move="", fen=start_fen)]
        fen = start_fen
        for i, m in enumerate(move_list, start=1):
            fen = apply_move(fen, m)
            positions.append(Position(move_index=i, move=m, fen=fen))

    return GameDetail(
        id=game.id,
        variant=game.variant or "xiangqi",
        initial_fen=game.initial_fen or INITIAL_FEN,
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
