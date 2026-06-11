"""象棋道 — 后端入口。"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .models import init_db
from .ratelimit import limiter
from .routes import (
    admin,
    analysis,
    auth,
    challenge,
    coach,
    credits,
    engine_admin,
    games,
    play,
    stats,
    training,
)

_IS_PROD = os.environ.get("XQ_ENV", "").lower() in ("prod", "production")

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

# CORS：默认放开仅为本地开发；生产用 XQ_ORIGINS 指定允许的前端来源（逗号分隔）。
_origins_env = os.environ.get("XQ_ORIGINS", "").strip()
_allow_origins = [o.strip() for o in _origins_env.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(engine_admin.router)
app.include_router(training.router)
app.include_router(challenge.router)
app.include_router(stats.router)
app.include_router(coach.router)
app.include_router(credits.router)
app.include_router(play.router)
# analysis 必须在 games 前注册：/games/{id}/analyze 否则被 games 的 DELETE /{id} 拦截
app.include_router(analysis.router)
app.include_router(games.router)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}
