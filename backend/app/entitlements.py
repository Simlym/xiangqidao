"""会员权益：界面展示与服务端授权共同使用的单一事实来源。"""

from datetime import datetime

from fastapi import Depends, HTTPException

from .auth import current_user
from .models import User

AI_FEATURES = ("ai_analysis", "ai_training", "cloud_engine")


def membership_active(user: User, now: datetime | None = None) -> bool:
    """管理员始终拥有会员能力；普通会员必须未过期。"""
    if user.role == "admin":
        return True
    if user.plan != "pro" or user.membership_expires_at is None:
        return False
    return user.membership_expires_at > (now or datetime.utcnow())


def entitlement_payload(user: User) -> dict:
    active = membership_active(user)
    return {
        "plan": "pro" if active else "free",
        "active": active,
        "expires_at": user.membership_expires_at,
        "features": list(AI_FEATURES) if active else [],
    }


def require_ai_member(user: User = Depends(current_user)) -> User:
    if not membership_active(user):
        raise HTTPException(403, "该云端 AI 功能需要开通会员")
    return user
