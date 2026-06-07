"""象棋道 — 后端入口。"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import init_db
from .routes import analysis, games, play, stats, training

app = FastAPI(title="象棋道 Xiangqidao", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(training.router)
app.include_router(stats.router)
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
