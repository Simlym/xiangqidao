"""管理员后台接口：用户与题库管理。所有接口需管理员权限。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..deps import get_db
from ..models import Attempt, Game, Puzzle, Review, User

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class AdminUser(BaseModel):
    id: int
    username: str
    role: str
    attempts: int
    learned: int


class AdminPuzzle(BaseModel):
    id: int
    fen: str
    solution: str
    side_to_move: str
    category: str
    difficulty: int
    source: str
    verified: bool


class NewPuzzle(BaseModel):
    fen: str
    solution: str           # 逗号分隔的 UCI 着法
    side_to_move: str = "w"
    category: str = "未分类"
    difficulty: int = 3
    source: str = "admin"
    mate_check: bool = True  # 单步杀法用内置规则校验


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    return {
        "users": db.scalar(select(func.count()).select_from(User)) or 0,
        "puzzles": db.scalar(select(func.count()).select_from(Puzzle)) or 0,
        "games": db.scalar(select(func.count()).select_from(Game)) or 0,
        "attempts": db.scalar(select(func.count()).select_from(Attempt)) or 0,
    }


@router.get("/users", response_model=list[AdminUser])
def list_users(db: Session = Depends(get_db)):
    users = db.scalars(select(User).order_by(User.id)).all()
    out = []
    for u in users:
        attempts = db.scalar(
            select(func.count()).select_from(Attempt).where(Attempt.user_id == u.username)
        ) or 0
        learned = db.scalar(
            select(func.count()).select_from(Review).where(Review.user_id == u.username)
        ) or 0
        out.append(AdminUser(id=u.id, username=u.username, role=u.role,
                             attempts=attempts, learned=learned))
    return out


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "用户不存在")
    if user.id == admin.id:
        raise HTTPException(400, "不能删除自己")
    # 一并清理其训练数据
    db.query(Attempt).filter(Attempt.user_id == user.username).delete()
    db.query(Review).filter(Review.user_id == user.username).delete()
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.get("/puzzles", response_model=list[AdminPuzzle])
def list_puzzles(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    puzzles = db.scalars(
        select(Puzzle).order_by(Puzzle.id.desc()).offset(offset).limit(limit)
    ).all()
    return [
        AdminPuzzle(
            id=p.id, fen=p.fen, solution=p.solution, side_to_move=p.side_to_move,
            category=p.category, difficulty=p.difficulty, source=p.source, verified=p.verified,
        )
        for p in puzzles
    ]


@router.post("/puzzles", response_model=AdminPuzzle)
def create_puzzle(body: NewPuzzle, db: Session = Depends(get_db)):
    solution = ",".join(m.strip() for m in body.solution.replace(" ", ",").split(",") if m.strip())
    if not solution:
        raise HTTPException(400, "正解不能为空")

    verified = False
    if body.mate_check and len(solution.split(",")) == 1:
        from ..importer.verify_mate import is_mate_in_one

        full = body.fen if len(body.fen.split()) > 1 else body.fen + " " + body.side_to_move
        ok, why = is_mate_in_one(full, solution)
        if not ok:
            raise HTTPException(400, f"校验未通过：{why}")
        verified = True

    p = Puzzle(
        fen=body.fen, solution=solution, side_to_move=body.side_to_move,
        category=body.category, difficulty=body.difficulty, source=body.source, verified=verified,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return AdminPuzzle(
        id=p.id, fen=p.fen, solution=p.solution, side_to_move=p.side_to_move,
        category=p.category, difficulty=p.difficulty, source=p.source, verified=p.verified,
    )


@router.delete("/puzzles/{puzzle_id}")
def delete_puzzle(puzzle_id: int, db: Session = Depends(get_db)):
    p = db.get(Puzzle, puzzle_id)
    if not p:
        raise HTTPException(404, "题目不存在")
    db.query(Review).filter(Review.puzzle_id == puzzle_id).delete()
    db.query(Attempt).filter(Attempt.puzzle_id == puzzle_id).delete()
    db.delete(p)
    db.commit()
    return {"ok": True}
