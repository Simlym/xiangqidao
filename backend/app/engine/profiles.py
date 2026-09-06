"""用户提供的服务端 UCI 引擎配置与平台信息。"""

from __future__ import annotations

import os
import platform
from typing import Literal

from app.core import models
from app.core.settings import (
    KEY_JIEQI_ENGINE_PATH,
    KEY_XIANGQI_ENGINE_PATH,
    get_setting,
)

Variant = Literal["xiangqi", "jieqi"]


def platform_info() -> dict[str, str]:
    system = platform.system().lower()
    os_name = "windows" if system.startswith("win") else "macos" if system == "darwin" else "linux"
    return {"os": os_name, "arch": platform.machine().lower()}


def configured_path(variant: Variant) -> str:
    key = KEY_JIEQI_ENGINE_PATH if variant == "jieqi" else KEY_XIANGQI_ENGINE_PATH
    try:
        db = models.SessionLocal()
        try:
            return get_setting(db, key).strip()
        finally:
            db.close()
    except Exception:
        return ""


def find_engine_path(variant: Variant) -> str | None:
    """只发现管理员明确提供的路径，不下载、不猜测第三方引擎。"""
    env_name = "JIEQI_ENGINE" if variant == "jieqi" else "XIANGQI_ENGINE"
    candidates = (configured_path(variant), os.getenv(env_name, "").strip())
    return next((os.path.abspath(path) for path in candidates if path and os.path.isfile(path)), None)


def profile_status(variant: Variant) -> dict:
    configured = configured_path(variant)
    env_name = "JIEQI_ENGINE" if variant == "jieqi" else "XIANGQI_ENGINE"
    env_path = os.getenv(env_name, "").strip()
    effective = find_engine_path(variant)
    return {
        "variant": variant,
        "configured_path": configured,
        "effective_path": effective or "",
        "available": bool(effective),
        "source": "admin" if configured else "environment" if env_path else "none",
        **platform_info(),
    }
