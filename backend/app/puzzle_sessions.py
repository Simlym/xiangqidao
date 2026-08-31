"""服务端可信解题会话。"""

from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import Puzzle, PuzzleSession

SESSION_TTL = timedelta(hours=6)


def create_session(db: Session, user: str, puzzle: Puzzle, context: str) -> PuzzleSession:
    now = datetime.utcnow()
    # 取新题时顺手清理本用户过期会话，避免长期使用后表无限增长。
    db.query(PuzzleSession).filter(
        PuzzleSession.user_id == user,
        PuzzleSession.expires_at < now,
    ).delete(synchronize_session=False)
    session = PuzzleSession(
        id=uuid4().hex,
        user_id=user,
        puzzle_id=puzzle.id,
        context=context,
        expires_at=now + SESSION_TTL,
    )
    db.add(session)
    db.commit()
    return session


def require_session(
    db: Session,
    session_id: str,
    user: str,
    puzzle_id: int,
    context: str | None = None,
) -> PuzzleSession:
    session = db.get(PuzzleSession, session_id)
    if (
        session is None
        or session.user_id != user
        or session.puzzle_id != puzzle_id
        or (context is not None and session.context != context)
    ):
        raise HTTPException(404, "解题会话不存在，请重新进入题目")
    if session.expires_at < datetime.utcnow():
        raise HTTPException(410, "解题会话已过期，请重新进入题目")
    return session
