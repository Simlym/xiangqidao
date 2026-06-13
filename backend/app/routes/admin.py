"""管理员后台接口：用户与题库管理。所有接口需管理员权限。"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import credits
from ..auth import require_admin
from ..deps import get_db
from ..models import (
    Attempt,
    CreditAccount,
    CreditLog,
    Game,
    LLMCallLog,
    Puzzle,
    Review,
    SecurityLog,
    User,
    UserStat,
)
from ..security_log import admin_action
from ..settings import (
    KEY_DEEPSEEK_API_KEY,
    KEY_DEEPSEEK_ENABLED,
    KEY_DEEPSEEK_MODEL,
    KEY_DEEPSEEK_REASONING_EFFORT,
    KEY_DEEPSEEK_THINKING,
    get_deepseek_config,
    set_setting,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class AdminUser(BaseModel):
    id: int
    username: str
    role: str
    created_at: str          # 注册时间（UTC ISO）
    last_login: str          # 最近登录（UTC ISO），从未登录为空串
    attempts: int            # 练习：作答次数
    learned: int             # 练习：已学题数
    games: int               # 对弈/复盘：棋局数
    rating: int | None       # 做题 ELO（无档案为 None）
    credits: int             # 积分余额
    checkin_streak: int      # 连续签到天数


class AdminPuzzle(BaseModel):
    id: int
    fen: str
    solution: str
    side_to_move: str
    kind: str
    category: str
    difficulty: int
    steps: int
    source: str
    verified: bool


class AdminPuzzleList(BaseModel):
    total: int
    categories: list[str]
    items: list[AdminPuzzle]


class NewPuzzle(BaseModel):
    fen: str
    solution: str           # 逗号分隔的 UCI 着法
    side_to_move: str = "w"
    kind: str = "杀法"
    category: str = "未分类"
    difficulty: int = 3
    source: str = "admin"
    mate_check: bool = True  # 单步杀法用内置规则校验


def _admin_puzzle(p) -> "AdminPuzzle":
    return AdminPuzzle(
        id=p.id, fen=p.fen, solution=p.solution, side_to_move=p.side_to_move,
        kind=getattr(p, "kind", "杀法") or "杀法", category=p.category,
        difficulty=p.difficulty, steps=getattr(p, "steps", 1) or 1,
        source=p.source, verified=p.verified,
    )


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    return {
        "users": db.scalar(select(func.count()).select_from(User)) or 0,
        "puzzles": db.scalar(select(func.count()).select_from(Puzzle)) or 0,
        "games": db.scalar(select(func.count()).select_from(Game)) or 0,
        "attempts": db.scalar(select(func.count()).select_from(Attempt)) or 0,
    }


def _count_by_user(db: Session, model) -> dict[str, int]:
    """按 user_id 一次聚合计数，避免对每个用户逐条查询。"""
    rows = db.execute(
        select(model.user_id, func.count()).group_by(model.user_id)
    ).all()
    return {uid: int(n) for uid, n in rows}


@router.get("/users", response_model=list[AdminUser])
def list_users(db: Session = Depends(get_db)):
    """用户列表（含练习/对弈/积分/登录等运营分析维度）。"""
    users = db.scalars(select(User).order_by(User.id)).all()
    attempts = _count_by_user(db, Attempt)
    learned = _count_by_user(db, Review)
    games = _count_by_user(db, Game)
    stats = {s.user_id: s for s in db.scalars(select(UserStat)).all()}
    accounts = {a.user_id: a for a in db.scalars(select(CreditAccount)).all()}

    out = []
    for u in users:
        stat = stats.get(u.username)
        acc = accounts.get(u.username)
        out.append(AdminUser(
            id=u.id, username=u.username, role=u.role,
            created_at=u.created_at.isoformat(timespec="seconds") if u.created_at else "",
            last_login=u.last_login.isoformat(timespec="seconds") if u.last_login else "",
            attempts=attempts.get(u.username, 0),
            learned=learned.get(u.username, 0),
            games=games.get(u.username, 0),
            rating=stat.rating if stat else None,
            credits=acc.balance if acc else 0,
            checkin_streak=acc.checkin_streak if acc else 0,
        ))
    return out


@router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "用户不存在")
    if user.id == admin.id:
        raise HTTPException(400, "不能删除自己")
    # 一并清理其训练数据与积分数据（不清积分会让同名重注在旧余额上再领注册赠送）
    db.query(Attempt).filter(Attempt.user_id == user.username).delete()
    db.query(Review).filter(Review.user_id == user.username).delete()
    db.query(CreditLog).filter(CreditLog.user_id == user.username).delete()
    db.query(CreditAccount).filter(CreditAccount.user_id == user.username).delete()
    db.delete(user)
    db.commit()
    admin_action(request, admin.username, "delete_user", user.username, db=db)
    return {"ok": True}


class AdminCreditLogRow(BaseModel):
    ts: str
    kind: str        # earn:* / spend:* / refund:* / grant:signup / admin:adjust
    amount: int
    balance_after: int
    ref: str


class AdminCredits(BaseModel):
    username: str
    balance: int
    total_earned: int
    checkin_streak: int
    last_checkin: str    # ISO 日期，从未签到为空串
    logs: list[AdminCreditLogRow]


class CreditAdjustBody(BaseModel):
    delta: int           # 正为发放、负为扣减（扣减以余额封底，不会扣成负数）
    reason: str = ""


def _admin_credits_view(db: Session, username: str, log_limit: int = 50) -> AdminCredits:
    acc = db.get(CreditAccount, username)
    rows = db.scalars(
        select(CreditLog).where(CreditLog.user_id == username)
        .order_by(CreditLog.id.desc()).limit(log_limit)
    ).all()
    return AdminCredits(
        username=username,
        balance=acc.balance if acc else 0,
        total_earned=acc.total_earned if acc else 0,
        checkin_streak=acc.checkin_streak if acc else 0,
        last_checkin=acc.last_checkin.isoformat() if acc and acc.last_checkin else "",
        logs=[
            AdminCreditLogRow(
                ts=r.ts.isoformat(sep=" ", timespec="seconds"),
                kind=r.kind, amount=r.amount, balance_after=r.balance_after, ref=r.ref,
            )
            for r in rows
        ],
    )


@router.get("/credits/{username}", response_model=AdminCredits)
def user_credits(username: str, limit: int = 50, db: Session = Depends(get_db)):
    """某用户的积分账户与近期流水（注意：积分账户按用户名而非数字 ID 标识）。"""
    if not db.scalar(select(User).where(User.username == username)):
        raise HTTPException(404, "用户不存在")
    return _admin_credits_view(db, username, min(max(limit, 1), 200))


@router.post("/credits/{username}/adjust", response_model=AdminCredits)
def adjust_credits(username: str, body: CreditAdjustBody, request: Request,
                   db: Session = Depends(get_db),
                   admin: User = Depends(require_admin)):
    """手工调整用户积分（客服补偿 / 纠错 / 活动发放），记审计日志。"""
    if not db.scalar(select(User).where(User.username == username)):
        raise HTTPException(404, "用户不存在")
    if body.delta == 0:
        raise HTTPException(400, "调整数值不能为 0")
    if abs(body.delta) > 100_000:
        raise HTTPException(400, "单次调整不能超过 100000")
    credits.admin_adjust(db, username, body.delta, body.reason.strip())
    admin_action(request, admin.username, "adjust_credits",
                 f"{username}:{body.delta:+d} {body.reason.strip()}"[:120], db=db)
    return _admin_credits_view(db, username)


@router.get("/puzzles", response_model=AdminPuzzleList)
def list_puzzles(limit: int = 20, offset: int = 0, category: str = "",
                 difficulty: int = 0, q: str = "", db: Session = Depends(get_db)):
    query = select(Puzzle)
    if category:
        query = query.where(Puzzle.category == category)
    if difficulty:
        query = query.where(Puzzle.difficulty == difficulty)
    if q:
        like = f"%{q}%"
        conds = [Puzzle.solution.like(like), Puzzle.fen.like(like), Puzzle.category.like(like)]
        if q.isdigit():
            conds.append(Puzzle.id == int(q))
        query = query.where(or_(*conds))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    puzzles = db.scalars(
        query.order_by(Puzzle.id.desc()).offset(offset).limit(limit)
    ).all()
    categories = db.scalars(
        select(Puzzle.category).distinct().order_by(Puzzle.category)
    ).all()
    return AdminPuzzleList(
        total=total,
        categories=[c for c in categories if c],
        items=[_admin_puzzle(p) for p in puzzles],
    )


@router.post("/puzzles", response_model=AdminPuzzle)
def create_puzzle(body: NewPuzzle, db: Session = Depends(get_db)):
    solution = ",".join(m.strip() for m in body.solution.replace(" ", ",").split(",") if m.strip())
    if not solution:
        raise HTTPException(400, "正解不能为空")

    verified = False
    if body.mate_check and len(solution.split(",")) == 1:
        from ..importer.verify_mate import is_mate_in_one

        full = body.fen if len(body.fen.split()) > 1 else body.fen + " " + body.side_to_move
        ok, why = is_mate_in_one(full, solution)
        if not ok:
            raise HTTPException(400, f"校验未通过：{why}")
        verified = True

    p = Puzzle(
        fen=body.fen, solution=solution, side_to_move=body.side_to_move,
        kind=body.kind, category=body.category, difficulty=body.difficulty,
        steps=(len(solution.split(",")) + 1) // 2, source=body.source, verified=verified,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _admin_puzzle(p)


class LlmSettings(BaseModel):
    enabled: bool
    model: str
    thinking_enabled: bool   # V4 thinking 模式开关
    reasoning_effort: str    # "high" / "max"
    has_key: bool            # 是否已配置密钥（DB 或环境变量）
    key_hint: str            # 密钥尾 4 位脱敏提示，如 "••••3f9a"
    active: bool             # 当前是否真正生效（开关开 + 有密钥）


class LlmSettingsUpdate(BaseModel):
    enabled: bool | None = None
    model: str | None = None
    thinking_enabled: bool | None = None
    reasoning_effort: str | None = None
    api_key: str | None = None   # 传入则覆盖；传空串清除（回退环境变量）；不传则保留


def _llm_settings_view(db: Session) -> LlmSettings:
    cfg = get_deepseek_config(db)
    hint = ("••••" + cfg.api_key[-4:]) if cfg.api_key else ""
    return LlmSettings(
        enabled=cfg.enabled, model=cfg.model,
        thinking_enabled=cfg.thinking_enabled, reasoning_effort=cfg.reasoning_effort,
        has_key=bool(cfg.api_key), key_hint=hint, active=cfg.active,
    )


@router.get("/settings/llm", response_model=LlmSettings)
def get_llm_settings(db: Session = Depends(get_db)):
    """读取 AI 复盘配置（密钥仅返回脱敏尾号）。"""
    return _llm_settings_view(db)


@router.put("/settings/llm", response_model=LlmSettings)
def update_llm_settings(body: LlmSettingsUpdate, request: Request,
                        db: Session = Depends(get_db),
                        admin: User = Depends(require_admin)):
    """更新 AI 复盘配置。api_key 传 None 保留原值、传 "" 清除、传非空覆盖。"""
    changed = []
    if body.enabled is not None:
        set_setting(db, KEY_DEEPSEEK_ENABLED, "1" if body.enabled else "0")
        changed.append(f"enabled={body.enabled}")
    if body.model is not None:
        set_setting(db, KEY_DEEPSEEK_MODEL, body.model.strip())
        changed.append("model")
    if body.thinking_enabled is not None:
        set_setting(db, KEY_DEEPSEEK_THINKING, "1" if body.thinking_enabled else "0")
        changed.append(f"thinking_enabled={body.thinking_enabled}")
    if body.reasoning_effort is not None:
        effort = body.reasoning_effort.strip().lower()
        set_setting(db, KEY_DEEPSEEK_REASONING_EFFORT, effort)
        changed.append(f"reasoning_effort={effort}")
    if body.api_key is not None:
        # 只记录「改了密钥」这一事实，绝不记录密钥本身
        set_setting(db, KEY_DEEPSEEK_API_KEY, body.api_key.strip())
        changed.append("api_key")
    db.commit()
    admin_action(request, admin.username, "update_llm_settings", ",".join(changed), db=db)
    return _llm_settings_view(db)


@router.post("/settings/llm/test")
def test_llm_settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """用当前配置发一次最小请求，验证密钥是否可用。仅管理员可调用。"""
    from ..llm import _chat_raw

    cfg = get_deepseek_config(db)
    if not cfg.active:
        raise HTTPException(400, "未启用或未配置密钥")
    # thinking 模式会先生成大段推理，最小请求也可能较慢，放宽超时避免误判为不可达
    reply, err = _chat_raw("回复\"ok\"两个字即可。", max_tokens=64, timeout=60,
                           feature="admin_test", user_id=admin.username, ref="test")
    if not reply:
        raise HTTPException(502, f"调用失败：{err or '空响应'}")
    return {"ok": True, "reply": reply.strip()[:50]}


# 事项 key -> 中文标签（与 llm.py 各函数的 feature 对应）
LLM_FEATURE_LABELS = {
    "explain_mistake": "失误讲解",
    "summarize_game": "复盘报告",
    "coach_move": "走法点评",
    "explain_puzzle": "题目讲解",
    "coach_plan": "教练计划",
    "admin_test": "连接测试",
    "unknown": "未标记",
}


def _llm_usage_agg(db: Session, since: datetime | None):
    """聚合 since 之后的 LLM 用量：调用次数、各类 token、总费用。since=None 表示全部。"""
    q = select(
        func.count(LLMCallLog.id),
        func.coalesce(func.sum(LLMCallLog.prompt_tokens), 0),
        func.coalesce(func.sum(LLMCallLog.completion_tokens), 0),
        func.coalesce(func.sum(LLMCallLog.total_tokens), 0),
        func.coalesce(func.sum(LLMCallLog.cost_usd), 0.0),
    )
    if since is not None:
        q = q.where(LLMCallLog.ts >= since)
    calls, prompt, completion, total, cost = db.execute(q).one()
    return {
        "calls": calls,
        "prompt_tokens": int(prompt),
        "completion_tokens": int(completion),
        "total_tokens": int(total),
        "cost_usd": round(float(cost), 6),
    }


@router.get("/llm-usage/summary")
def llm_usage_summary(db: Session = Depends(get_db)):
    """LLM 用量汇总：今日 / 本月 / 全部，以及按事项的费用分布。"""
    now = datetime.utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # 按事项分组的费用/次数分布（全量）
    rows = db.execute(
        select(
            LLMCallLog.feature,
            func.count(LLMCallLog.id),
            func.coalesce(func.sum(LLMCallLog.total_tokens), 0),
            func.coalesce(func.sum(LLMCallLog.cost_usd), 0.0),
        ).group_by(LLMCallLog.feature)
        .order_by(func.sum(LLMCallLog.cost_usd).desc())
    ).all()
    by_feature = [
        {
            "feature": feat,
            "label": LLM_FEATURE_LABELS.get(feat, feat),
            "calls": calls,
            "total_tokens": int(toks),
            "cost_usd": round(float(cost), 6),
        }
        for feat, calls, toks, cost in rows
    ]
    return {
        "today": _llm_usage_agg(db, today),
        "month": _llm_usage_agg(db, month),
        "all": _llm_usage_agg(db, None),
        "by_feature": by_feature,
    }


class LLMUsageRow(BaseModel):
    id: int
    ts: str
    feature: str
    label: str
    user_id: str
    model: str
    prompt_tokens: int
    cached_tokens: int
    completion_tokens: int
    reasoning_tokens: int
    total_tokens: int
    cost_usd: float
    duration_ms: int
    success: bool
    error: str
    ref: str


@router.get("/llm-usage")
def llm_usage_list(limit: int = 50, offset: int = 0, feature: str | None = None,
                   user_id: str | None = None, db: Session = Depends(get_db)):
    """LLM 调用明细（分页，可按事项/用户筛选），按时间倒序。"""
    query = select(LLMCallLog)
    if feature:
        query = query.where(LLMCallLog.feature == feature)
    if user_id:
        query = query.where(LLMCallLog.user_id == user_id)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(
        query.order_by(LLMCallLog.ts.desc()).limit(min(limit, 200)).offset(offset)
    ).scalars().all()
    items = [
        LLMUsageRow(
            id=r.id,
            ts=r.ts.isoformat(),
            feature=r.feature,
            label=LLM_FEATURE_LABELS.get(r.feature, r.feature),
            user_id=r.user_id,
            model=r.model,
            prompt_tokens=r.prompt_tokens,
            cached_tokens=r.cached_tokens,
            completion_tokens=r.completion_tokens,
            reasoning_tokens=r.reasoning_tokens,
            total_tokens=r.total_tokens,
            cost_usd=round(r.cost_usd, 6),
            duration_ms=r.duration_ms,
            success=r.success,
            error=r.error,
            ref=r.ref,
        )
        for r in rows
    ]
    return {
        "items": items,
        "total": total,
        "features": [
            {"key": k, "label": v} for k, v in LLM_FEATURE_LABELS.items()
        ],
    }


class LogLevelUpdate(BaseModel):
    level: str  # DEBUG / INFO / WARNING / ERROR


@router.get("/syslog")
def get_syslog(after_seq: int = 0, db: Session = Depends(get_db)):
    """读取最近的系统运行日志（内存环形缓冲，进程重启即清空）。

    after_seq 用于增量轮询：只返回比上次更新的记录。与「安全审计日志 /logs」不同，
    这里是面向排查的运行日志（含 LLM 提示词/思考/输出，等级调到 DEBUG 可见）。
    """
    from .. import log_buffer

    return {
        "level": log_buffer.get_level(),
        "supported_levels": list(log_buffer.SUPPORTED_LEVELS),
        "records": log_buffer.get_records(after_seq=after_seq),
    }


@router.put("/syslog/level")
def update_log_level(body: LogLevelUpdate, request: Request,
                     db: Session = Depends(get_db),
                     admin: User = Depends(require_admin)):
    """调整系统日志等级（落库持久化 + 立即生效）。DEBUG 可看到 LLM 提示词/思考/输出。"""
    from .. import log_buffer

    level = body.level.strip().upper()
    if level not in log_buffer.SUPPORTED_LEVELS:
        raise HTTPException(400, f"不支持的日志等级：{level}")
    set_setting(db, log_buffer.KEY_LOG_LEVEL, level)
    db.commit()
    log_buffer.set_level(level)
    admin_action(request, admin.username, "update_log_level", level, db=db)
    return {"level": log_buffer.get_level()}


@router.post("/syslog/clear")
def clear_syslog(request: Request, admin: User = Depends(require_admin)):
    """清空内存日志缓冲。"""
    from .. import log_buffer

    log_buffer.clear()
    admin_action(request, admin.username, "clear_logs", "", db=None)
    return {"ok": True}


@router.delete("/puzzles/{puzzle_id}")
def delete_puzzle(puzzle_id: int, request: Request, db: Session = Depends(get_db),
                  admin: User = Depends(require_admin)):
    p = db.get(Puzzle, puzzle_id)
    if not p:
        raise HTTPException(404, "题目不存在")
    db.query(Review).filter(Review.puzzle_id == puzzle_id).delete()
    db.query(Attempt).filter(Attempt.puzzle_id == puzzle_id).delete()
    db.delete(p)
    db.commit()
    admin_action(request, admin.username, "delete_puzzle", str(puzzle_id), db=db)
    return {"ok": True}


class AdminLog(BaseModel):
    id: int
    ts: str
    level: str
    event: str
    ip: str
    actor: str
    action: str
    target: str


@router.get("/logs", response_model=list[AdminLog])
def list_logs(limit: int = 100, offset: int = 0, event: str | None = None,
              db: Session = Depends(get_db)):
    """安全审计日志，按时间倒序分页。event 可选过滤（login_failed / admin_action）。"""
    q = select(SecurityLog).order_by(SecurityLog.id.desc())
    if event:
        q = q.where(SecurityLog.event == event)
    rows = db.scalars(q.offset(max(offset, 0)).limit(min(max(limit, 1), 500))).all()
    return [
        AdminLog(
            id=r.id, ts=r.ts.isoformat(sep=" ", timespec="seconds"),
            level=r.level, event=r.event, ip=r.ip,
            actor=r.actor, action=r.action, target=r.target,
        )
        for r in rows
    ]
