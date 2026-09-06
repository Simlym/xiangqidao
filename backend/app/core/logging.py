"""内存环形日志缓冲：把 xiangqidao.* 的日志收进内存，供后台「系统日志」页查看。

设计要点：
- 一个挂在父 logger "xiangqidao" 上的 Handler，子 logger（llm/security/...）的记录都会冒泡上来；
- 只保留最近 MAX_RECORDS 条（deque 环形），不落库、不占数据库，进程重启即清空，专供排查；
- 日志等级存数据库（app_settings），后台可调，启动时与更新时应用到父 logger。
"""
from __future__ import annotations

import logging
import threading
import time
from collections import deque

ROOT_LOGGER = "xiangqidao"          # 父 logger，所有业务 logger 以此为前缀
MAX_RECORDS = 500                    # 环形缓冲容量
KEY_LOG_LEVEL = "log_level"         # app_settings 中的键名
DEFAULT_LEVEL = "INFO"
SUPPORTED_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")

_lock = threading.Lock()
_records: deque[dict] = deque(maxlen=MAX_RECORDS)
_seq = 0  # 单调递增序号，便于前端增量拉取


class _BufferHandler(logging.Handler):
    """把每条日志格式化后存进内存环形缓冲。"""

    def emit(self, record: logging.LogRecord) -> None:
        global _seq
        try:
            msg = self.format(record)
        except Exception:  # noqa: BLE001 — 格式化失败不应影响业务
            msg = record.getMessage()
        with _lock:
            _seq += 1
            _records.append({
                "seq": _seq,
                "ts": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created)),
                "level": record.levelname,
                "logger": record.name,
                "message": msg,
            })

    def format(self, record: logging.LogRecord) -> str:
        # 只取消息正文（含 exc 堆栈），时间/等级/logger 已单独存字段
        text = record.getMessage()
        if record.exc_info:
            text += "\n" + self.formatter.formatException(record.exc_info) if self.formatter \
                else "\n" + logging.Formatter().formatException(record.exc_info)
        return text


_handler: _BufferHandler | None = None


def setup_buffer(level: str = DEFAULT_LEVEL) -> None:
    """在父 logger 上安装缓冲 Handler 并设置等级（幂等，重复调用只更新等级）。"""
    global _handler
    logger = logging.getLogger(ROOT_LOGGER)
    set_level(level)
    if _handler is None:
        _handler = _BufferHandler()
        _handler.setLevel(logging.DEBUG)  # 由 logger 级别统一过滤，handler 不再二次拦
        logger.addHandler(_handler)
    # 让记录同时继续冒泡给 uvicorn 的 root handler（控制台仍可见），故不动 propagate


def set_level(level: str) -> None:
    """设置父 logger 的等级（影响所有 xiangqidao.* 子 logger 与缓冲）。"""
    lvl = level.upper()
    if lvl not in SUPPORTED_LEVELS:
        lvl = DEFAULT_LEVEL
    logging.getLogger(ROOT_LOGGER).setLevel(getattr(logging, lvl))


def get_level() -> str:
    lvl = logging.getLogger(ROOT_LOGGER).level
    return logging.getLevelName(lvl) if lvl else DEFAULT_LEVEL


def get_records(after_seq: int = 0, limit: int = MAX_RECORDS) -> list[dict]:
    """返回 seq > after_seq 的日志（按时间正序），便于前端增量轮询。"""
    with _lock:
        out = [r for r in _records if r["seq"] > after_seq]
    return out[-limit:]


def clear() -> None:
    with _lock:
        _records.clear()
