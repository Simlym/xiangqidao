"""当前账号的会员权益。"""

from fastapi import APIRouter, Depends

from .schemas import EntitlementsOut
from .service import current_user
from .entitlements import entitlement_payload
from app.core.models import User

router = APIRouter(prefix="/api/account", tags=["account"])


@router.get("/entitlements", response_model=EntitlementsOut)
def entitlements(user: User = Depends(current_user)):
    return entitlement_payload(user)
