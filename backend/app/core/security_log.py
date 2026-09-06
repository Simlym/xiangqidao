"""安全审计日志：记录登录失败与管理员敏感操作。

刻意只记录「谁、何时、从哪、做了什么」，绝不写入密码、token、API key 等敏感值。
始终输出到名为 "xiangqidao.security" 的 logger（继承 uvicorn 的处理器落盘）；
若调用方传入 db 会话，则同时落库到 security_logs 表，供后台分页查看。
"""

from __future__ import annotations

import logging

from fastapi import Request
from sqlalchemy.orm import Session

logger = logging.getLogger("xiangqidao.security")


def _client_ip(request: Request | None) -> str:
    if request is None or request.client is None:
        return "-"
    return request.client.host


def _persist(db: Session | None, level: str, event: str, ip: str,
             actor: str = "", action: str = "", target: str = "") -> None:
    """写入一行审计日志。落库失败绝不能影响主流程，故吞掉异常并回滚。"""
    if db is None:
        return
    try:
        from .models import SecurityLog

        db.add(SecurityLog(
            level=level, event=event, ip=ip,
            actor=actor[:40], action=action[:40], target=str(target)[:120],
        ))
        db.commit()
    except Exception:  # noqa: BLE001 — 审计日志失败不应阻断业务
        db.rollback()
        logger.exception("security_log persist failed event=%s", event)


def login_failed(request: Request | None, username: str, db: Session | None = None) -> None:
    # 用户名可能含敏感/超长内容，截断并标注，避免日志注入与膨胀
    safe = (username or "")[:40].replace("\n", " ").replace("\r", " ")
    ip = _client_ip(request)
    logger.warning("login_failed ip=%s user=%r", ip, safe)
    _persist(db, "warning", "login_failed", ip, actor=safe)


def admin_action(request: Request | None, actor: str, action: str,
                 target: str = "", db: Session | None = None) -> None:
    ip = _client_ip(request)
    logger.info("admin_action ip=%s actor=%r action=%s target=%s", ip, actor, action, target)
    _persist(db, "info", "admin_action", ip, actor=actor, action=action, target=target)
