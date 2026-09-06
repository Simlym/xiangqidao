"""象棋道 — 后端入口。"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .api import register_routes
from .core.database import init_db
from .core.rate_limit import limiter
from .engine import install as engine_install

_IS_PROD = os.environ.get("APP_ENV", "").lower() in ("prod", "production")

# 生产环境关闭交互式文档，减少攻击面；开发保留 /docs 方便调试。
app = FastAPI(
    title="象棋道 Xiangqidao",
    version="0.1.0",
    docs_url=None if _IS_PROD else "/docs",
    redoc_url=None if _IS_PROD else "/redoc",
    openapi_url=None if _IS_PROD else "/openapi.json",
)

# 限流：装配 limiter 与超额处理器（返回 429）。
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS：默认放开仅为本地开发；生产用 CORS_ORIGINS 指定允许的前端来源（逗号分隔）。
_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
_allow_origins = [o.strip() for o in _origins_env.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_routes(app)


@app.on_event("startup")
def _startup() -> None:
    init_db()
    _setup_logging()  # 安装内存日志缓冲，等级取自数据库设置（后台可调）
    engine_install.warm_cpu_cache()  # 后台预热 CPU 探测，使首个引擎状态请求不再卡数秒


def _setup_logging() -> None:
    """据数据库设置安装日志缓冲与等级；读不到则用默认 INFO。"""
    from .core import logging as log_buffer
    from .core.database import SessionLocal
    from .core.settings import get_setting

    level = log_buffer.DEFAULT_LEVEL
    db = SessionLocal()
    try:
        level = get_setting(db, log_buffer.KEY_LOG_LEVEL, log_buffer.DEFAULT_LEVEL)
    except Exception:
        pass
    finally:
        db.close()
    log_buffer.setup_buffer(level)


@app.get("/api/health")
def health():
    return {"status": "ok"}
