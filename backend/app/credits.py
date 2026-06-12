"""积分系统：大模型（LLM）权益的内部货币，集中在此模块管理获取与消耗。

核心目的：防止未登录用户疯狂调用付费大模型接口刷成本。
- 仅登录用户拥有积分账户；访客（GUEST_USER）无账户、无法消耗，故 LLM 功能必须登录。
- 调用大模型的功能按动作扣分（AI 教练、对局分析点评、题目讲解、走法点评）。
- 通过签到 / 对弈 / 做题赚取积分，引导用户多在平台下棋、训练。
- 默认成本与奖励见 DEFAULT_*，管理员可用 AppSetting 覆盖（键名见 _setting_key），无需重启。

并发说明：面向 SQLite 单进程部署，余额采用读-改-写；极端并发下可能有竞态，
对「内部权益货币」而言可接受，不引入额外锁。
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import GUEST_USER
from .models import CreditAccount, CreditLog
from .settings import get_setting

# 注册新用户赠送，够体验各项大模型功能若干次
DEFAULT_SIGNUP_GRANT = 200

# 赚取规则（每次动作的入账积分）
DEFAULT_EARN = {
    "checkin": 20,          # 每日签到基础分
    "game": 10,             # 完成一局有效对弈
    "puzzle": 3,            # 首次做对一道题
}
# 连续签到奖励：每多连签一天 +step，封顶 cap（叠加在 checkin 基础分之上）
DEFAULT_CHECKIN_STREAK_STEP = 5
DEFAULT_CHECKIN_STREAK_CAP = 30

# 每日赚取上限（防刷）；签到天然每日一次，无需上限
DEFAULT_DAILY_CAP = {
    "game": 50,
    "puzzle": 60,
}

# 消耗规则（调用大模型各功能的成本）
DEFAULT_COST = {
    "coach_plan": 20,        # 生成/刷新 AI 教练训练计划
    "game_report": 10,       # 对局综合复盘报告
    "mistake_explain": 2,    # 单步失误讲解（一局分析可能多次）
    "puzzle_explain": 8,     # 题目解题思路讲解
    "play_coach": 4,         # 对弈中走法点评
}

_MIN_GAME_MOVES = 12  # 少于此手数的对局不计对弈奖励，防止空局刷分

# 签到与每日上限的「一天」按此时区切换，而非服务器本地时区。
# 目标用户群在国内，默认北京时间；部署在 UTC 服务器时若不设置，
# 日期会在北京时间早 8 点才切换，签到与连签判定都会错乱。
DEFAULT_TZ = "Asia/Shanghai"


def _today() -> date:
    """积分体系的「今天」：按 XQ_TZ（默认 Asia/Shanghai）取日期。"""
    name = os.environ.get("XQ_TZ", DEFAULT_TZ).strip() or DEFAULT_TZ
    try:
        return datetime.now(ZoneInfo(name)).date()
    except Exception:  # 时区名无效或系统缺 tzdata 时退回服务器本地日期
        return date.today()


# ── 配置读取（AppSetting 覆盖默认值）────────────────────────────

def _int_setting(db: Session, key: str, default: int) -> int:
    raw = get_setting(db, key)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        return default


def cost(db: Session, action: str) -> int:
    """某个大模型动作的消耗积分。"""
    return _int_setting(db, f"credit_cost_{action}", DEFAULT_COST.get(action, 0))


def _earn_amount(db: Session, action: str) -> int:
    return _int_setting(db, f"credit_earn_{action}", DEFAULT_EARN.get(action, 0))


def _daily_cap(db: Session, action: str) -> int:
    return _int_setting(db, f"credit_cap_{action}", DEFAULT_DAILY_CAP.get(action, 0))


def costs(db: Session) -> dict[str, int]:
    """全部大模型动作成本，供前端展示「消耗 N 积分」。"""
    return {a: cost(db, a) for a in DEFAULT_COST}


def earn_rates(db: Session) -> dict[str, int]:
    return {a: _earn_amount(db, a) for a in DEFAULT_EARN}


# ── 账户与流水 ─────────────────────────────────────────────────

def _is_member(user_id: str) -> bool:
    """是否为真实登录用户（非访客）。访客不建账户、不计积分。"""
    return bool(user_id) and user_id != GUEST_USER


def get_account(db: Session, user_id: str) -> CreditAccount | None:
    if not _is_member(user_id):
        return None
    acc = db.get(CreditAccount, user_id)
    if acc is None:
        acc = CreditAccount(user_id=user_id, balance=0)
        db.add(acc)
        db.flush()
    return acc


def balance(db: Session, user_id: str) -> int:
    acc = db.get(CreditAccount, user_id) if _is_member(user_id) else None
    return acc.balance if acc else 0


def _log(db: Session, acc: CreditAccount, kind: str, amount: int, ref: str) -> None:
    db.add(
        CreditLog(
            user_id=acc.user_id,
            kind=kind,
            amount=amount,
            balance_after=acc.balance,
            ref=ref,
            day=_today(),
        )
    )


def _earned_today(db: Session, user_id: str, action: str) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(CreditLog.amount), 0)).where(
            CreditLog.user_id == user_id,
            CreditLog.kind == f"earn:{action}",
            CreditLog.day == _today(),
        )
    )
    return int(total or 0)


def grant_signup(db: Session, user_id: str) -> int:
    """注册赠送初始积分。同一 user_id 仅发放一次（按 grant:signup 流水判重），
    防止删号重注、重复调用等场景反复领取。"""
    if not _is_member(user_id):
        return 0
    granted = db.scalar(
        select(func.count()).select_from(CreditLog).where(
            CreditLog.user_id == user_id,
            CreditLog.kind == "grant:signup",
        )
    )
    if granted:
        return 0
    acc = get_account(db, user_id)
    amount = _int_setting(db, "credit_signup_grant", DEFAULT_SIGNUP_GRANT)
    if amount <= 0:
        return 0
    acc.balance += amount
    acc.updated_at = datetime.utcnow()
    _log(db, acc, "grant:signup", amount, "")
    db.commit()
    return amount


def can_afford(db: Session, user_id: str, action: str) -> bool:
    return balance(db, user_id) >= cost(db, action)


def try_spend(db: Session, user_id: str, action: str, ref: str = "") -> bool:
    """扣减一次动作成本；余额不足或非会员返回 False（不抛异常）。

    供后台分析等「能扣则扣、扣不动就降级为纯数据」的场景使用。
    """
    if not _is_member(user_id):
        return False
    price = cost(db, action)
    acc = get_account(db, user_id)
    if acc.balance < price:
        return False
    acc.balance -= price
    acc.updated_at = datetime.utcnow()
    _log(db, acc, f"spend:{action}", -price, ref)
    db.commit()
    return True


def refund(db: Session, user_id: str, action: str, ref: str = "") -> None:
    """退回一次动作成本（如大模型调用失败、返回空）。"""
    if not _is_member(user_id):
        return
    price = cost(db, action)
    if price <= 0:
        return
    acc = get_account(db, user_id)
    acc.balance += price
    acc.updated_at = datetime.utcnow()
    _log(db, acc, f"refund:{action}", price, ref)
    db.commit()


def admin_adjust(db: Session, user_id: str, delta: int, reason: str = "") -> int:
    """管理员手工调整（补偿 / 纠错 / 活动发放）。返回实际变动数。

    扣减不会把余额扣成负数（按余额封底）；流水 kind 为 'admin:adjust'，
    ref 记录原因，审计日志由调用方（admin 路由）负责。
    """
    if not _is_member(user_id):
        return 0
    acc = get_account(db, user_id)
    actual = max(delta, -acc.balance)  # 最多扣到 0
    if actual == 0:
        return 0
    acc.balance += actual
    if actual > 0:
        acc.total_earned += actual
    acc.updated_at = datetime.utcnow()
    _log(db, acc, "admin:adjust", actual, reason[:80])
    db.commit()
    return actual


def earn(db: Session, user_id: str, action: str, ref: str = "") -> int:
    """因正向行为（对弈 / 做题）入账积分，遵守每日上限。返回实际入账数。"""
    if not _is_member(user_id):
        return 0
    amount = _earn_amount(db, action)
    if amount <= 0:
        return 0
    cap = _daily_cap(db, action)
    if cap > 0:
        room = cap - _earned_today(db, user_id, action)
        if room <= 0:
            return 0
        amount = min(amount, room)
    acc = get_account(db, user_id)
    acc.balance += amount
    acc.total_earned += amount
    acc.updated_at = datetime.utcnow()
    _log(db, acc, f"earn:{action}", amount, ref)
    db.commit()
    return amount


def award_game(db: Session, user_id: str, move_count: int, ref: str = "") -> int:
    """完成一局对弈的奖励：要求达到最小手数，且受每日上限约束。"""
    if move_count < _MIN_GAME_MOVES:
        return 0
    return earn(db, user_id, "game", ref)


def checkin(db: Session, user_id: str) -> dict:
    """每日签到。返回 {already, awarded, balance, streak}。

    连续签到（昨日也签到过）累计 streak 并按 step 给递增奖励，封顶 cap。
    """
    if not _is_member(user_id):
        return {"already": False, "awarded": 0, "balance": 0, "streak": 0}
    acc = get_account(db, user_id)
    today = _today()
    if acc.last_checkin == today:
        return {"already": True, "awarded": 0, "balance": acc.balance, "streak": acc.checkin_streak}

    # 连签判定：昨天签过则 +1，否则重置为 1
    if acc.last_checkin == today - timedelta(days=1):
        acc.checkin_streak += 1
    else:
        acc.checkin_streak = 1

    base = _earn_amount(db, "checkin")
    step = _int_setting(db, "credit_checkin_streak_step", DEFAULT_CHECKIN_STREAK_STEP)
    cap = _int_setting(db, "credit_checkin_streak_cap", DEFAULT_CHECKIN_STREAK_CAP)
    bonus = min((acc.checkin_streak - 1) * step, cap)
    awarded = base + bonus

    acc.balance += awarded
    acc.total_earned += awarded
    acc.last_checkin = today
    acc.updated_at = datetime.utcnow()
    _log(db, acc, "earn:checkin", awarded, f"streak:{acc.checkin_streak}")
    db.commit()
    return {"already": False, "awarded": awarded, "balance": acc.balance, "streak": acc.checkin_streak}


def summary(db: Session, user_id: str) -> dict:
    """账户概览，供前端展示余额、签到状态与价目表。"""
    acc = db.get(CreditAccount, user_id) if _is_member(user_id) else None
    today = _today()
    return {
        "balance": acc.balance if acc else 0,
        "total_earned": acc.total_earned if acc else 0,
        "checkin_today": bool(acc and acc.last_checkin == today),
        "checkin_streak": acc.checkin_streak if acc else 0,
        "costs": costs(db),
        "earn_rates": earn_rates(db),
        "is_member": _is_member(user_id),
    }
