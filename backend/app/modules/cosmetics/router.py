"""外观商店：查看目录与使用积分买断棋盘、棋子、音效。"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .schemas import PurchaseIn
from . import service as cosmetics
from app.modules.credits import service as credits
from app.modules.auth.service import current_user, current_user_id
from app.core.dependencies import get_db
from app.core.models import CosmeticPurchase, CreditLog, User
from app.core.rate_limit import limiter

router = APIRouter(prefix="/api/cosmetics", tags=["cosmetics"])


@router.get("/catalog")
def catalog(db: Session = Depends(get_db), user_id: str = Depends(current_user_id)):
    return cosmetics.catalog_payload(db, user_id)


@router.post("/purchase")
@limiter.limit("20/minute")
def purchase(
    payload: PurchaseIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    asset = cosmetics.find_asset(payload.asset_key)
    if not asset:
        raise HTTPException(404, "外观资源不存在")
    if asset["price"] <= 0:
        return {"purchased": False, "already_owned": True, "balance": credits.balance(db, user.username)}

    existing = db.query(CosmeticPurchase).filter_by(
        user_id=user.username, asset_key=payload.asset_key
    ).first()
    if existing:
        return {"purchased": False, "already_owned": True, "balance": credits.balance(db, user.username)}

    account = credits.get_account(db, user.username)
    price = int(asset["price"])
    if account.balance < price:
        raise HTTPException(402, f"积分不足，解锁「{asset['name']}」需要 {price} 积分")

    account.balance -= price
    account.updated_at = datetime.utcnow()
    purchase_row = CosmeticPurchase(
        user_id=user.username, asset_key=payload.asset_key, price_paid=price
    )
    db.add(purchase_row)
    db.add(CreditLog(
        user_id=user.username,
        kind="spend:cosmetic",
        amount=-price,
        balance_after=account.balance,
        ref=f"cosmetic:{payload.asset_key}",
    ))
    db.commit()
    return {"purchased": True, "already_owned": False, "balance": account.balance}
