"""管理后台：Pikafish 引擎一键安装 / 更新 / 卸载。所有接口需管理员权限。"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from .. import engine_install
from ..auth import require_admin
from ..models import User
from ..security_log import admin_action

router = APIRouter(
    prefix="/api/admin/engine", tags=["admin"], dependencies=[Depends(require_admin)]
)


class InstallRequest(BaseModel):
    variant: str | None = None  # 留空=按本机 CPU 自动挑最快变体（自检失败自动回退）


@router.get("")
def get_status():
    """返回引擎安装状态、操作系统、安装进度等，供前端展示与轮询。"""
    return engine_install.status()


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
