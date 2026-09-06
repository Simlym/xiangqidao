"""HTTP 路由注册表；集中维护装配顺序，入口不感知具体业务模块。"""

from fastapi import FastAPI

from .modules.admin import api as admin, engine_api as engine_admin
from .modules.auth import account_api as account, api as auth
from .modules.challenge import api as challenge
from .modules.coach import api as coach
from .modules.cosmetics import api as cosmetics
from .modules.credits import api as credits
from .modules.games import analysis_api as analysis, api as games
from .modules.jieqi import api as variants
from .modules.learning import api as learning
from .modules.play import api as play
from .modules.stats import api as stats, today_api as today
from .modules.training import api as training

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
