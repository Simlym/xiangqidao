"""管理后台：标准象棋与揭棋 Pikafish 配置。所有接口需管理员权限。"""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import engine_install
from ..auth import require_admin
from ..deps import get_db
from ..jieqi_engine import find_jieqi_engine, reset_shared_jieqi_engine
from ..models import User
from ..security_log import admin_action
from ..settings import KEY_JIEQI_ENGINE_PATH, get_setting, set_setting

router = APIRouter(
    prefix="/api/admin/engine", tags=["admin"], dependencies=[Depends(require_admin)]
)


class InstallRequest(BaseModel):
    variant: str | None = None  # 留空=按本机 CPU 自动挑最快变体（自检失败自动回退）


class JieqiEngineUpdate(BaseModel):
    path: str = Field(default="", max_length=1000)


def _jieqi_status(db: Session) -> dict:
    configured = get_setting(db, KEY_JIEQI_ENGINE_PATH).strip()
    env_path = os.getenv("XQ_JIEQI_ENGINE", "").strip()
    effective = find_jieqi_engine()
    if configured:
        source = "admin"
    elif env_path:
        source = "environment"
    elif effective:
        source = "managed"
    else:
        source = "none"
    return {
        "configured_path": configured,
        "effective_path": os.path.abspath(effective) if effective else "",
        "available": bool(effective),
        "source": source,
    }


@router.get("")
def get_status():
    """返回引擎安装状态、操作系统、安装进度等，供前端展示与轮询。"""
    return engine_install.status()


@router.get("/jieqi")
def get_jieqi_status(db: Session = Depends(get_db)):
    """读取 Web 服务器当前的揭棋引擎路径和发现状态。"""
    return _jieqi_status(db)


@router.put("/jieqi")
def update_jieqi_engine(body: JieqiEngineUpdate, request: Request,
                         db: Session = Depends(get_db),
                         admin: User = Depends(require_admin)):
    """保存揭棋引擎绝对路径；传空字符串则恢复环境变量/固定目录发现。"""
    path = body.path.strip()
    if path:
        if not os.path.isabs(path):
            raise HTTPException(400, "请填写服务器上的绝对路径")
        path = os.path.abspath(path)
        if not os.path.isfile(path):
            raise HTTPException(400, "服务器上找不到该引擎文件")
    set_setting(db, KEY_JIEQI_ENGINE_PATH, path)
    db.commit()
    reset_shared_jieqi_engine()
    admin_action(
        request,
        admin.username,
        "update_jieqi_engine",
        "configured" if path else "cleared",
        db=db,
    )
    return _jieqi_status(db)


@router.post("/install")
def install(body: InstallRequest, request: Request, admin: User = Depends(require_admin)):
    """从官方 Release 下载并安装/更新 Pikafish（后台异步执行，前端轮询进度）。"""
    variant = engine_install.sanitize_variant(body.variant)
    res = engine_install.start_install(variant)
    admin_action(request, admin.username, "install_engine", variant or "auto")
    return {**engine_install.status(), **res}


@router.delete("")
def remove(request: Request, admin: User = Depends(require_admin)):
    """卸载受管目录中的 Pikafish，回退到 PATH / 内置引擎。"""
    engine_install.remove()
    admin_action(request, admin.username, "remove_engine", "")
    return engine_install.status()
