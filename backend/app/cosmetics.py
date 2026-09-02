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
    {"key": "app_clear", "type": "app", "theme": "clear", "name": "清朗晴空", "description": "高对比、大留白，长时间阅读更轻松", "price": 0},
    {"key": "app_neon", "type": "app", "theme": "neon", "name": "霓虹棋域", "description": "深空底色搭配电光青紫，年轻而有速度感", "price": 0},
    {"key": "app_candy", "type": "app", "theme": "candy", "name": "糖果课堂", "description": "明快柔和的马卡龙色，适合儿童与亲子学习", "price": 0},
    {"key": "app_focus", "type": "app", "theme": "focus", "name": "雾蓝专注", "description": "克制的灰蓝界面，为高频训练减少视觉干扰", "price": 0},
    {"key": "app_palace", "type": "app", "theme": "palace", "name": "宫墙朱漆", "description": "深宫红、鎏金与墨黑，庄重而有收藏感", "price": 0},
    {"key": "app_coast", "type": "app", "theme": "coast", "name": "海岛晴岚", "description": "海盐蓝、沙滩米白与珊瑚色，轻松明快", "price": 0},
    {"key": "app_forest", "type": "app", "theme": "forest", "name": "松林棋社", "description": "苔绿、松针与暖灰，适合长时间安静对弈", "price": 0},
    {"key": "app_mono", "type": "app", "theme": "mono", "name": "黑白研究室", "description": "近黑白的理性界面，让数据与局面成为主角", "price": 0},
    {"key": "app_pixel", "type": "app", "theme": "pixel", "name": "像素残局", "description": "掌机灰、亮绿与硬边框，复古游戏机风格", "price": 0},
    {"key": "board_classic", "type": "board", "theme": "classic", "name": "榆木经典", "description": "温润木色与传统楚河汉界", "price": 0},
    {"key": "board_paper", "type": "board", "theme": "paper", "name": "宣纸棋枰", "description": "素雅宣纸与淡墨线条", "price": 0},
    {"key": "board_jade", "type": "board", "theme": "jade", "name": "翡翠棋台", "description": "深青玉质棋台与金色线条", "price": 120},
    {"key": "board_clear", "type": "board", "theme": "clear", "name": "清朗棋盘", "description": "乳白底、深棕粗线，光线复杂时也容易辨认", "price": 0},
    {"key": "board_neon", "type": "board", "theme": "neon", "name": "电光网格", "description": "靛蓝棋面与青色发光线条", "price": 0},
    {"key": "board_candy", "type": "board", "theme": "candy", "name": "积木棋盘", "description": "奶油黄棋面配莓果色线条，活泼不刺眼", "price": 0},
    {"key": "board_focus", "type": "board", "theme": "focus", "name": "石墨棋盘", "description": "低饱和灰蓝棋面，只保留必要层级", "price": 0},
    {"key": "board_coast", "type": "board", "theme": "coast", "name": "浅滩棋盘", "description": "细沙色棋面与海水蓝线条，清爽通透", "price": 0},
    {"key": "board_forest", "type": "board", "theme": "forest", "name": "苔庭棋盘", "description": "灰绿石面配深松色线条，柔和护眼", "price": 0},
    {"key": "board_mono", "type": "board", "theme": "mono", "name": "研究室棋盘", "description": "纯灰阶与精准细线，便于分析和录屏", "price": 0},
    {"key": "board_pixel", "type": "board", "theme": "pixel", "name": "掌机网格", "description": "像素硬边与液晶绿棋面，复古而清晰", "price": 0},
    {"key": "piece_classic", "type": "piece", "theme": "classic", "name": "牙色楷书", "description": "传统象牙色圆子", "price": 0},
    {"key": "piece_ink", "type": "piece", "theme": "ink", "name": "水墨棋子", "description": "简洁平面纸感棋子", "price": 0},
    {"key": "piece_jade", "type": "piece", "theme": "jade", "name": "青白玉子", "description": "通透玉质与镏金内圈", "price": 100},
    {"key": "piece_bold", "type": "piece", "theme": "bold", "name": "醒目大字", "description": "高对比粗体棋子，远看和小屏都清楚", "price": 0},
    {"key": "piece_neon", "type": "piece", "theme": "neon", "name": "能量棋子", "description": "深色圆片、荧光描边与冷光文字", "price": 0},
    {"key": "piece_candy", "type": "piece", "theme": "candy", "name": "糖果棋子", "description": "柔软立体的彩色棋子，亲切易识别", "price": 0},
    {"key": "piece_focus", "type": "piece", "theme": "focus", "name": "无衬线棋子", "description": "现代粗体字与平面圆片，利落安静", "price": 0},
    {"key": "piece_seal", "type": "piece", "theme": "seal", "name": "篆印棋子", "description": "朱白印章与篆刻感字形，适合宣纸棋盘", "price": 0},
    {"key": "piece_lacquer", "type": "piece", "theme": "lacquer", "name": "朱漆金边", "description": "黑红漆面、金色内圈与宫廷质感", "price": 0},
    {"key": "piece_shell", "type": "piece", "theme": "shell", "name": "贝壳棋子", "description": "珍珠光泽与海蓝描边，轻盈柔和", "price": 0},
    {"key": "piece_stone", "type": "piece", "theme": "stone", "name": "溪石棋子", "description": "浅灰石质、深绿文字，沉静自然", "price": 0},
    {"key": "piece_mono", "type": "piece", "theme": "mono", "name": "黑白棋子", "description": "纯黑白平面棋子，直播和小尺寸画面也清楚", "price": 0},
    {"key": "piece_pixel", "type": "piece", "theme": "pixel", "name": "像素棋子", "description": "八方向硬边圆片与点阵字感，掌机味十足", "price": 0},
    {"key": "sound_wood", "type": "sound", "theme": "wood", "name": "木质落子", "description": "沉稳的实木棋子声", "price": 0},
    {"key": "sound_crisp", "type": "sound", "theme": "crisp", "name": "清脆瓷音", "description": "清亮短促的碰击声", "price": 0},
    {"key": "sound_beep", "type": "sound", "theme": "beep", "name": "电子节拍", "description": "简洁的电子提示音", "price": 0},
    {"key": "sound_temple", "type": "sound", "theme": "temple", "name": "古寺梵音", "description": "木鱼与钟磬风格音色", "price": 80},
    {"key": "sound_clear", "type": "sound", "theme": "clear", "name": "清晰提示", "description": "频段分明、节奏舒缓，提示明确不惊扰", "price": 0},
    {"key": "sound_arcade", "type": "sound", "theme": "arcade", "name": "街机脉冲", "description": "短促合成器与升级旋律，反馈更有冲劲", "price": 0},
    {"key": "sound_bubble", "type": "sound", "theme": "bubble", "name": "泡泡音符", "description": "圆润弹跳的音色，轻松又有趣", "price": 0},
    {"key": "sound_soft", "type": "sound", "theme": "soft", "name": "轻触音", "description": "极短、低存在感的提示音，适合专注训练", "price": 0},
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
