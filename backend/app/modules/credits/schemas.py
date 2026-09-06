"""积分接口的请求与响应结构。"""

from pydantic import BaseModel


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
