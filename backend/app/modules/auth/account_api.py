"""当前账号的会员权益。"""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .service import current_user
from .entitlements import entitlement_payload
from app.core.models import User

router = APIRouter(prefix="/api/account", tags=["account"])


class EntitlementsOut(BaseModel):
    plan: str
    active: bool
    expires_at: datetime | None
    features: list[str]


@router.get("/entitlements", response_model=EntitlementsOut)
def entitlements(user: User = Depends(current_user)):
    return entitlement_payload(user)
