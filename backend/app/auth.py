"""轻量鉴权：标准库实现的密码哈希与签名 token，无第三方依赖。

token 形如 base64url(payload) + "." + base64url(hmac)，payload 含用户名与过期时间。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .deps import get_db
from .models import User

SECRET = os.environ.get("XQ_SECRET", "xiangqidao-dev-secret-change-me").encode()
TOKEN_TTL = 60 * 60 * 24 * 14  # 14 天
PBKDF2_ITER = 120_000
GUEST_USER = "default"  # 未登录时的访客数据归属，保持单用户向后兼容


# ── 密码 ────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITER)
    return f"pbkdf2${PBKDF2_ITER}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iter_s, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iter_s))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ── token ───────────────────────────────────────────────────────

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(username: str) -> str:
    payload = json.dumps({"u": username, "exp": int(time.time()) + TOKEN_TTL}).encode()
    body = _b64(payload)
    sig = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def parse_token(token: str) -> str | None:
    """校验 token，返回用户名；无效或过期返回 None。"""
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("exp", 0) < time.time():
            return None
        return payload.get("u")
    except Exception:
        return None


# ── 依赖 ────────────────────────────────────────────────────────

def _username_from_header(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return parse_token(authorization[7:])


def current_user_id(authorization: str | None = Header(default=None)) -> str:
    """返回数据归属的 user_id：已登录用其用户名，未登录用访客 default。"""
    return _username_from_header(authorization) or GUEST_USER


def current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """要求已登录，返回 User；否则 401。"""
    username = _username_from_header(authorization)
    if not username:
        raise HTTPException(401, "未登录或登录已过期")
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(401, "用户不存在")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user
