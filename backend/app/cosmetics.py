"""外观商店目录与买断解锁。

客户端可以打包全部外观资源，但是价格和已购权益始终以服务端为准。
当前使用积分支付；日后接入现金支付时，仍可复用 CosmeticPurchase 作为交付凭证。
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CosmeticPurchase

CATALOG = (
    {"key": "app_classic", "type": "app", "theme": "classic", "name": "雅木暖棕", "description": "象棋道经典暖棕与米白配色", "price": 0},
    {"key": "app_ink", "type": "app", "theme": "ink", "name": "宣纸墨韵", "description": "纸白、炭黑与一抹朱砂红", "price": 0},
    {"key": "app_jade", "type": "app", "theme": "jade", "name": "翡翠深庭", "description": "沉静翠绿、暖金与玉白", "price": 120},
    {"key": "app_night", "type": "app", "theme": "night", "name": "夜弈玄青", "description": "专为夜间对弈设计的低亮深蓝主题", "price": 100},
    {"key": "board_classic", "type": "board", "theme": "classic", "name": "榆木经典", "description": "温润木色与传统楚河汉界", "price": 0},
    {"key": "board_paper", "type": "board", "theme": "paper", "name": "宣纸棋枰", "description": "素雅宣纸与淡墨线条", "price": 0},
    {"key": "board_jade", "type": "board", "theme": "jade", "name": "翡翠棋台", "description": "深青玉质棋台与金色线条", "price": 120},
    {"key": "piece_classic", "type": "piece", "theme": "classic", "name": "牙色楷书", "description": "传统象牙色圆子", "price": 0},
    {"key": "piece_ink", "type": "piece", "theme": "ink", "name": "水墨棋子", "description": "简洁平面纸感棋子", "price": 0},
    {"key": "piece_jade", "type": "piece", "theme": "jade", "name": "青白玉子", "description": "通透玉质与镏金内圈", "price": 100},
    {"key": "sound_wood", "type": "sound", "theme": "wood", "name": "木质落子", "description": "沉稳的实木棋子声", "price": 0},
    {"key": "sound_crisp", "type": "sound", "theme": "crisp", "name": "清脆瓷音", "description": "清亮短促的碰击声", "price": 0},
    {"key": "sound_beep", "type": "sound", "theme": "beep", "name": "电子节拍", "description": "简洁的电子提示音", "price": 0},
    {"key": "sound_temple", "type": "sound", "theme": "temple", "name": "古寺梵音", "description": "木鱼与钟磬风格音色", "price": 80},
)


def find_asset(asset_key: str) -> dict | None:
    return next((item for item in CATALOG if item["key"] == asset_key), None)


def owned_keys(db: Session, user_id: str) -> set[str]:
    if not user_id or user_id == "default":
        return set()
    return set(db.scalars(select(CosmeticPurchase.asset_key).where(CosmeticPurchase.user_id == user_id)))


def catalog_payload(db: Session, user_id: str) -> dict:
    owned = owned_keys(db, user_id)
    return {
        "items": [{**item, "owned": item["price"] == 0 or item["key"] in owned} for item in CATALOG],
        "currency": "credits",
    }
