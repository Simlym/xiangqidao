"""揭棋 Pikafish 独立实例，不与标准象棋引擎共享协议状态。"""

import os
import threading

from .engine import Engine

_shared: Engine | None = None
_lock = threading.Lock()


def find_jieqi_engine() -> str | None:
    configured = os.getenv("XQ_JIEQI_ENGINE", "").strip()
    candidates = [
        configured,
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

