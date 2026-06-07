"""SM-2 间隔重复算法。

参考 SuperMemo-2。质量评分 quality 取值 0-5：
  0-2 视为答错（重置 repetitions，间隔回到 1 天）
  3-5 视为答对（按 ease_factor 拉长间隔）

在训练 UI 中我们用四档自评映射到 quality：
  再来(Again)=1  困难(Hard)=3  良好(Good)=4  容易(Easy)=5
"""

from dataclasses import dataclass
from datetime import date, timedelta


MIN_EASE = 1.3


@dataclass
class SrsState:
    """一道题对某用户的复习状态。"""

    repetitions: int = 0          # 连续答对次数
    interval: int = 0             # 当前间隔（天）
    ease_factor: float = 2.5      # 难度系数
    next_review: date | None = None


def review(state: SrsState, quality: int, today: date | None = None) -> SrsState:
    """根据本次作答质量更新 SM-2 状态，返回新状态。"""
    if not 0 <= quality <= 5:
        raise ValueError("quality 必须在 0-5 之间")
    today = today or date.today()

    if quality < 3:
        # 答错：重新开始，明天再来
        repetitions = 0
        interval = 1
    else:
        repetitions = state.repetitions + 1
        if repetitions == 1:
            interval = 1
        elif repetitions == 2:
            interval = 6
        else:
            interval = round(state.interval * state.ease_factor)

    # 更新难度系数（答错也会更新，使其更易被频繁复习）
    ease = state.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    ease = max(MIN_EASE, ease)

    return SrsState(
        repetitions=repetitions,
        interval=interval,
        ease_factor=round(ease, 3),
        next_review=today + timedelta(days=interval),
    )
