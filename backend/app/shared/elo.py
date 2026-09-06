"""ELO 评分：给用户与题目各一个动态评分，做对/做错按强弱差调整。

设计目标——让用户有一个会随水平稳步变化的「数字」，作为留存与正反馈来源：
- 用户初始 1200；题目按难度映射初始分（1★≈800 … 5★≈1800）。
- 做对强题加分多、弱题加分少；做错弱题扣分多。题目分以更小的 K 反向微调，
  使其随大量作答逐渐收敛到「真实难度」。

评分只在用户「首次遇到某题」时结算一次，避免间隔复习反复刷分导致虚高。
"""

from __future__ import annotations

# 题目难度（1-5）→ 初始 ELO；与 database 迁移里的回填公式保持一致。
def difficulty_to_rating(difficulty: int) -> int:
    d = max(1, min(5, int(difficulty or 3)))
    return 550 + 250 * d  # 1→800 2→1050 3→1300 4→1550 5→1800


def expected_score(a: float, b: float) -> float:
    """评分 a 的一方对评分 b 的一方的期望胜率。"""
    return 1.0 / (1.0 + 10 ** ((b - a) / 400.0))


def _k_factor(rating: int, solved: int) -> int:
    """用户 K 因子：新手波动大、收敛快；高分稳定。"""
    if solved < 30:
        return 40
    if rating >= 2000:
        return 16
    return 24


def update_ratings(
    user_rating: int, puzzle_rating: int, score: float, solved: int
) -> tuple[int, int]:
    """返回 (新用户分, 新题目分)。score∈[0,1]：1=一次做对，0.5=重试后做对，0=未做出。"""
    eu = expected_score(user_rating, puzzle_rating)
    ku = _k_factor(user_rating, solved)
    new_user = round(user_rating + ku * (score - eu))
    # 题目分以固定小 K 反向调整（用户得分高=题偏易，应降分）
    ep = 1.0 - eu
    new_puzzle = round(puzzle_rating + 16 * ((1.0 - score) - ep))
    return new_user, new_puzzle


# 段位称号：纯展示用，给评分一个有质感的「头衔」。
_TIERS = [
    (2200, "棋圣"),
    (2000, "特级大师"),
    (1800, "象棋大师"),
    (1600, "区域冠军"),
    (1400, "高级棋手"),
    (1200, "中级棋手"),
    (1000, "初级棋手"),
    (800, "入门棋手"),
    (0, "象棋新手"),
]


def rank_title(rating: int) -> str:
    for threshold, title in _TIERS:
        if rating >= threshold:
            return title
    return "象棋新手"
