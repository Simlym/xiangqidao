"""揭棋 UCI 引擎独立实例，不与标准象棋引擎共享协议状态。"""

import threading

from .uci import Engine

_shared: Engine | None = None
_lock = threading.Lock()


def find_jieqi_engine() -> str | None:
    from .profiles import find_engine_path

    return find_engine_path("jieqi")


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

