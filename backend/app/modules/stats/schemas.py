"""统计接口的请求与响应结构。"""

from datetime import date

from pydantic import BaseModel


class Overview(BaseModel):
    total_puzzles: int
    learned: int            # 已有复习记录的题数
    due_today: int
    streak_days: int        # 连续打卡天数
    overall_accuracy: float # 总体正确率（按全部 attempts）
    first_try_accuracy: float  # 首答正确率（一次做对、未中途重试）


class CategoryStat(BaseModel):
    category: str
    attempts: int
    accuracy: float


class CatalogEntry(BaseModel):
    kind: str        # 大类：杀法/开局/中局/残局
    category: str    # 具体名目
    total: int       # 该名目题数
    learned: int     # 已学题数


class WeeklyPoint(BaseModel):
    week_start: date
    attempts: int
    accuracy: float


class ForecastPoint(BaseModel):
    day: date
    label: str      # 今天/明天/周几
    count: int      # 当天到期复习数
    overdue: bool    # 是否为已过期堆积（仅 day=today 那项可能为 True）


class RatingOut(BaseModel):
    rating: int
    peak: int
    solved: int
    title: str       # 段位称号


class LeaderboardRow(BaseModel):
    username: str
    rating: int
    title: str
    solved: int
    is_me: bool
