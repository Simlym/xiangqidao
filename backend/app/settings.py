"""运行时配置读写：引擎与 AI 复盘等管理员配置。"""
from __future__ import annotations

import os
from dataclasses import dataclass

from sqlalchemy.orm import Session

from .models import AppSetting, SessionLocal

# app_settings 表中使用的键名
KEY_LLM_API_KEY = "llm_api_key"
KEY_LLM_MODEL = "llm_model"
KEY_LLM_ENABLED = "llm_enabled"  # "1" / "0"
KEY_LLM_PROTOCOL = "llm_protocol"
KEY_LLM_BASE_URL = "llm_base_url"
KEY_LLM_THINKING_ENABLED = "llm_thinking_enabled"
KEY_LLM_REASONING_EFFORT = "llm_reasoning_effort"
KEY_JIEQI_ENGINE_PATH = "jieqi_engine_path"

PROTOCOL_OPENAI_CHAT = "openai_chat"
PROTOCOL_OPENAI_RESPONSES = "openai_responses"
PROTOCOL_ANTHROPIC = "anthropic"
LLM_PROTOCOLS = {PROTOCOL_OPENAI_CHAT, PROTOCOL_OPENAI_RESPONSES, PROTOCOL_ANTHROPIC}
LLM_REASONING_EFFORTS = {"low", "medium", "high", "xhigh", "max"}

DEFAULT_PROTOCOL = PROTOCOL_OPENAI_CHAT
DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4.1-mini"


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
class LlmConfig:
    api_key: str
    model: str
    enabled: bool  # 管理员开关
    protocol: str
    base_url: str
    thinking_enabled: bool
    reasoning_effort: str

    @property
    def active(self) -> bool:
        """真正会发起调用：开关打开且有密钥。"""
        return self.enabled and bool(self.api_key and self.model and self.base_url)


def _resolve(db: Session) -> LlmConfig:
    api_key = get_setting(db, KEY_LLM_API_KEY) or os.getenv("LLM_API_KEY", "")
    model = get_setting(db, KEY_LLM_MODEL) or os.getenv("LLM_MODEL", DEFAULT_MODEL)
    protocol = get_setting(db, KEY_LLM_PROTOCOL) or os.getenv("LLM_PROTOCOL", DEFAULT_PROTOCOL)
    if protocol not in LLM_PROTOCOLS:
        protocol = DEFAULT_PROTOCOL
    base_url = (
        get_setting(db, KEY_LLM_BASE_URL)
        or os.getenv("LLM_BASE_URL", DEFAULT_BASE_URL)
    ).strip().rstrip("/")
    thinking_enabled = (
        get_setting(db, KEY_LLM_THINKING_ENABLED)
        or os.getenv("LLM_THINKING_ENABLED", "1")
    ) != "0"
    reasoning_effort = (
        get_setting(db, KEY_LLM_REASONING_EFFORT)
        or os.getenv("LLM_REASONING_EFFORT", "high")
    )
    if reasoning_effort not in LLM_REASONING_EFFORTS:
        reasoning_effort = "high"
    # enabled 未显式设置时默认开启，保持既有 env 部署「配了 key 就生效」的行为
    enabled_raw = get_setting(db, KEY_LLM_ENABLED, "1")
    return LlmConfig(
        api_key=api_key.strip(), model=model.strip(), enabled=enabled_raw != "0",
        protocol=protocol, base_url=base_url,
        thinking_enabled=thinking_enabled, reasoning_effort=reasoning_effort,
    )


def get_llm_config(db: Session | None = None) -> LlmConfig:
    """解析通用 LLM 配置；不传 db 时自开短会话（供后台任务调用）。"""
    if db is not None:
        return _resolve(db)
    s = SessionLocal()
    try:
        return _resolve(s)
    finally:
        s.close()
