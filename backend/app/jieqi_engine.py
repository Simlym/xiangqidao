"""揭棋 Pikafish 独立实例，不与标准象棋引擎共享协议状态。"""

import os
import threading

from .engine import Engine

_shared: Engine | None = None
_lock = threading.Lock()


def find_jieqi_engine() -> str | None:
    # 管理后台保存的路径优先；环境变量继续作为无 UI 部署的兼容方式。
    configured = ""
    try:
        from .models import SessionLocal
        from .settings import KEY_JIEQI_ENGINE_PATH, get_setting

        db = SessionLocal()
        try:
            configured = get_setting(db, KEY_JIEQI_ENGINE_PATH).strip()
        finally:
            db.close()
    except Exception:
        # 数据库尚未初始化等场景仍可通过环境变量或固定目录启动。
        pass
    candidates = [
        configured,
        os.getenv("XQ_JIEQI_ENGINE", "").strip(),
        os.path.join("data", "engine", "jieqi", "PikaJieQi.exe"),
        os.path.join("data", "engine", "jieqi", "pikafish.exe"),
        os.path.join("data", "engine", "jieqi", "pikafish"),
    ]
    return next((path for path in candidates if path and os.path.isfile(path)), None)


def get_shared_jieqi_engine() -> Engine | None:
    global _shared
    with _lock:
        if _shared is not None and _shared.is_alive():
            return _shared
        path = find_jieqi_engine()
        if not path:
            return None
        try:
            _shared = Engine(path=path)
        except (FileNotFoundError, OSError):
            _shared = None
        return _shared


def reset_shared_jieqi_engine() -> None:
    """配置变化后关闭旧实例，使新路径无需重启服务即可生效。"""
    global _shared
    with _lock:
        if _shared is not None:
            try:
                _shared.close()
            except Exception:
                pass
        _shared = None

