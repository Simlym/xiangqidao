"""鉴权接口：注册 / 登录 / 当前用户。"""

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user, hash_password, make_token, verify_password
from ..deps import get_db
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 第一个注册的用户、或用户名匹配该环境变量的用户成为管理员
ADMIN_USERNAME = os.environ.get("XQ_ADMIN", "admin")


class Credentials(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    username: str
    role: str


class UserOut(BaseModel):
    username: str
    role: str


@router.post("/register", response_model=AuthResponse)
def register(body: Credentials, db: Session = Depends(get_db)):
    username = body.username.strip()
    if len(username) < 2 or len(body.password) < 4:
        raise HTTPException(400, "用户名至少2位、密码至少4位")
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(409, "用户名已被占用")

    # 首个用户或匹配管理员用户名 -> 管理员
    is_first = (db.scalar(select(func.count()).select_from(User)) or 0) == 0
    role = "admin" if (is_first or username == ADMIN_USERNAME) else "user"

    user = User(username=username, password_hash=hash_password(body.password), role=role)
    db.add(user)
    db.commit()
    return AuthResponse(token=make_token(username), username=username, role=role)


@router.post("/login", response_model=AuthResponse)
def login(body: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username.strip()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")
    return AuthResponse(token=make_token(user.username), username=user.username, role=user.role)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut(username=user.username, role=user.role)
