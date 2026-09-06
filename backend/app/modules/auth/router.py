"""鉴权接口：注册 / 登录 / 当前用户。"""

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .schemas import AuthResponse, Credentials, UserOut
from .service import current_user, guest_owner, hash_password, make_token, verify_password
from app.core.dependencies import get_db
from app.core.models import Attempt, CoachPlan, Game, LearningPack, Puzzle, PuzzleSession, Review, User, UserStat
from app.core.rate_limit import limiter
from app.core.security_log import login_failed

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 管理员引导：仅当 ADMIN_USERNAME 显式设置时，匹配该用户名者注册即为管理员；
# 未设置则只有「首个注册用户」成为管理员，避免公网上 'admin' 用户名被抢注提权。
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "").strip()


@router.post("/register", response_model=AuthResponse)
@limiter.limit("10/minute")
def register(request: Request, body: Credentials, db: Session = Depends(get_db)):
    username = body.username.strip()
    if len(username) < 2 or len(body.password) < 8:
        raise HTTPException(400, "用户名至少2位、密码至少8位")
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(409, "用户名已被占用")

    # 管理员引导：首个注册用户必为管理员；此外仅当显式配置 ADMIN_USERNAME 时匹配者为管理员。
    is_first = (db.scalar(select(func.count()).select_from(User)) or 0) == 0
    is_named_admin = bool(ADMIN_USERNAME) and username == ADMIN_USERNAME
    role = "admin" if (is_first or is_named_admin) else "user"

    user = User(username=username, password_hash=hash_password(body.password), role=role)
    db.add(user)
    db.flush()

    # 注册即认领本设备的游客数据。用户名刚创建，不会与既有进度发生唯一键冲突。
    guest = guest_owner(request.headers.get("x-guest-id"))
    if guest.startswith("guest:"):
        for model in (Review, Attempt, Game, Puzzle, CoachPlan, PuzzleSession, LearningPack):
            db.query(model).filter(model.user_id == guest).update(
                {model.user_id: username}, synchronize_session=False
            )
        stat = db.scalar(select(UserStat).where(UserStat.user_id == guest))
        if stat:
            stat.user_id = username
    db.commit()
    # 注册赠送初始积分，便于新用户立即体验 AI 教练等大模型功能
    from app.modules.credits import service as credits
    credits.grant_signup(db, username)
    return AuthResponse(token=make_token(username), username=username, role=role)


@router.post("/login", response_model=AuthResponse)
@limiter.limit("10/minute")
def login(request: Request, body: Credentials, db: Session = Depends(get_db)):
    username = body.username.strip()
    user = db.scalar(select(User).where(User.username == username))
    if not user or not verify_password(body.password, user.password_hash):
        login_failed(request, username, db=db)
        raise HTTPException(401, "用户名或密码错误")
    user.last_login = datetime.utcnow()  # 供管理后台查看用户活跃情况
    db.commit()
    return AuthResponse(token=make_token(user.username), username=user.username, role=user.role)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut(username=user.username, role=user.role)
