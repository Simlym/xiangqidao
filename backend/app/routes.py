"""HTTP 路由注册表；集中维护装配顺序，入口不感知具体业务模块。"""

from fastapi import FastAPI

from .modules.admin import engine_router as engine_admin, router as admin
from .modules.auth import account_router as account, router as auth
from .modules.challenge import router as challenge
from .modules.coach import router as coach
from .modules.cosmetics import router as cosmetics
from .modules.credits import router as credits
from .modules.games import analysis_router as analysis, router as games
from .modules.learning import router as learning
from .modules.play import router as play
from .modules.stats import router as stats
from .modules.today import router as today
from .modules.training import router as training
from .modules.variants import router as variants

API_ROUTERS = (
    auth.router,
    account.router,
    admin.router,
    engine_admin.router,
    training.router,
    today.router,
    learning.router,
    challenge.router,
    stats.router,
    coach.router,
    credits.router,
    cosmetics.router,
    play.router,
    variants.router,
    # 必须先于 games：/games/{id}/analyze 不能被 games 的 /{id} 捕获。
    analysis.router,
    games.router,
)


def register_routes(app: FastAPI) -> None:
    for router in API_ROUTERS:
        app.include_router(router)
