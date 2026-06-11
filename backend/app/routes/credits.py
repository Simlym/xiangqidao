"""积分接口：余额查询与每日签到。

积分是「大模型权益」的内部货币：调用 AI 教练、对局点评、题目讲解等会消耗积分；
签到、对弈、做题可赚取。所有接口要求登录（积分账户与真实账号绑定）。
"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import credits
from ..auth import current_user
from ..deps import get_db
from ..models import User
from ..ratelimit import limiter

router = APIRouter(prefix="/api/credits", tags=["credits"])


class CreditSummary(BaseModel):
    balance: int
    total_earned: int
    checkin_today: bool
    checkin_streak: int
    costs: dict[str, int]      # 各大模型动作的消耗
    earn_rates: dict[str, int] # 各正向行为的入账
    is_member: bool


class CheckinResult(BaseModel):
    already: bool   # 今日是否已签到
    awarded: int    # 本次入账积分
    balance: int
    streak: int


@router.get("/me", response_model=CreditSummary)
def my_credits(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return CreditSummary(**credits.summary(db, user.username))


@router.post("/checkin", response_model=CheckinResult)
@limiter.limit("30/minute")
def checkin(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return CheckinResult(**credits.checkin(db, user.username))
