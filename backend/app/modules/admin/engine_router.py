"""管理后台：配置用户自行提供的标准象棋与揭棋 UCI 引擎。"""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.core.models import User
from app.core.security_log import admin_action
from app.core.settings import KEY_JIEQI_ENGINE_PATH, KEY_XIANGQI_ENGINE_PATH, set_setting
from app.engine.jieqi import reset_shared_jieqi_engine
from app.engine.uci import reset_shared_engine
from app.engine.profiles import profile_status
from app.modules.auth.service import require_admin
from .schemas import EnginePathUpdate

router = APIRouter(
    prefix="/api/admin/engine", tags=["admin"], dependencies=[Depends(require_admin)]
)

_KEYS = {"xiangqi": KEY_XIANGQI_ENGINE_PATH, "jieqi": KEY_JIEQI_ENGINE_PATH}


@router.get("")
def get_status():
    """返回平台信息和双棋种配置；不访问第三方下载服务。"""
    return {
        "distribution": "user-provided",
        "xiangqi": profile_status("xiangqi"),
        "jieqi": profile_status("jieqi"),
    }


@router.get("/{variant}")
def get_variant_status(variant: str):
    if variant not in _KEYS:
        raise HTTPException(404, "不支持的棋种")
    return profile_status(variant)


@router.put("/{variant}")
def update_engine(
    variant: str,
    body: EnginePathUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """保存服务器上由管理员自行放置的引擎绝对路径。"""
    if variant not in _KEYS:
        raise HTTPException(404, "不支持的棋种")
    path = body.path.strip()
    if path:
        if not os.path.isabs(path):
            raise HTTPException(400, "请填写服务器上的绝对路径")
        path = os.path.abspath(path)
        if not os.path.isfile(path):
            raise HTTPException(400, "服务器上找不到该引擎文件")
    set_setting(db, _KEYS[variant], path)
    db.commit()
    if variant == "jieqi":
        reset_shared_jieqi_engine()
    else:
        reset_shared_engine()
    action = f"{variant}:configured" if path else f"{variant}:cleared"
    admin_action(request, admin.username, "update_user_engine", action, db=db)
    return profile_status(variant)
