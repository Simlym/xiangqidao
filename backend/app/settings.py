"""运行时配置读写：AI 复盘（DeepSeek）的开关与密钥。

优先级：数据库 app_settings 表 > 环境变量 > 默认值。这样既支持后台 UI 配置，
也兼容既有的纯环境变量部署。"""
from __future__ import annotations

import os
from dataclasses import dataclass

from sqlalchemy.orm import Session

from .models import AppSetting, SessionLocal

# app_settings 表中使用的键名
KEY_DEEPSEEK_API_KEY = "deepseek_api_key"
KEY_DEEPSEEK_MODEL = "deepseek_model"
KEY_DEEPSEEK_ENABLED = "deepseek_enabled"  # "1" / "0"

DEFAULT_MODEL = "deepseek-chat"


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(AppSetting, key)
    return row.value if row and row.value != "" else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


@dataclass
class DeepSeekConfig:
    api_key: str
    model: str
    enabled: bool  # 管理员开关

    @property
    def active(self) -> bool:
        """真正会发起调用：开关打开且有密钥。"""
        return self.enabled and bool(self.api_key)


def _resolve(db: Session) -> DeepSeekConfig:
    api_key = get_setting(db, KEY_DEEPSEEK_API_KEY) or os.getenv("DEEPSEEK_API_KEY", "")
    model = get_setting(db, KEY_DEEPSEEK_MODEL) or DEFAULT_MODEL
    # enabled 未显式设置时默认开启，保持既有 env 部署「配了 key 就生效」的行为
    enabled_raw = get_setting(db, KEY_DEEPSEEK_ENABLED, "1")
    return DeepSeekConfig(api_key=api_key, model=model, enabled=enabled_raw != "0")


def get_deepseek_config(db: Session | None = None) -> DeepSeekConfig:
    """解析 DeepSeek 配置；不传 db 时自开短会话（供后台任务调用）。"""
    if db is not None:
        return _resolve(db)
    s = SessionLocal()
    try:
        return _resolve(s)
    finally:
        s.close()
