"""数据模型。user_id 以用户名字符串标识，匿名场景回退 'default'。"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

# 持久化配置集中在 database 模块；此处再导出以保持既有导入路径可用
from .database import Base, SessionLocal, engine, init_db  # noqa: F401


class User(Base):
    """用户。role: 'user' 普通用户 / 'admin' 管理员。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(10), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Puzzle(Base):
    """战术题。

    solution 为正解着法序列，UCI 坐标制，逗号分隔，如 'h2e2,a9a8,...'。
    多步题按「己方/对方交替」排列：偶数位（0,2,4…）是玩家要走的着法，
    奇数位是对方的应着——做题时由系统自动走出，玩家只需输入己方着法。
    一步杀题即长度为 1 的特例。
    """

    __tablename__ = "puzzles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fen: Mapped[str] = mapped_column(String(120), nullable=False)
    solution: Mapped[str] = mapped_column(Text, nullable=False)
    side_to_move: Mapped[str] = mapped_column(String(1), default="w")  # w=红 b=黑
    # 两级分类：kind 为大类（杀法/开局/中局/残局），category 为具体战术名目
    # （卧槽马/双车错/对面笑…）。弱点专项与雷达图按 category，题库浏览/筛选按 kind。
    kind: Mapped[str] = mapped_column(String(10), default="杀法", index=True)
    category: Mapped[str] = mapped_column(String(40), default="未分类")  # 具体战术名目
    difficulty: Mapped[int] = mapped_column(Integer, default=3)         # 1-5
    steps: Mapped[int] = mapped_column(Integer, default=1)              # 解题回合数（mate-in-N 的 N）
    # 题目 ELO：随作答动态收敛到「真实难度」；空表示尚未初始化（按难度回填）
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(80), default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)      # 是否经引擎校验
    # 归属：'default' 表示公共题库（所有人可练）；其他值为某用户的私有题
    # （如实战漏着自动生成题），仅本人可见。
    user_id: Mapped[str] = mapped_column(String(40), default="default", index=True)
    # LLM 生成的解题讲解缓存：同一道题只调用一次大模型，之后直接复用
    ai_explanation: Mapped[str] = mapped_column(Text, default="")

    review: Mapped["Review | None"] = relationship(back_populates="puzzle", uselist=False)


class Review(Base):
    """SM-2 复习状态（每题一行）。"""

    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id"), unique=True)
    user_id: Mapped[str] = mapped_column(String(40), default="default", index=True)

    repetitions: Mapped[int] = mapped_column(Integer, default=0)
    interval: Mapped[int] = mapped_column(Integer, default=0)
    ease_factor: Mapped[float] = mapped_column(Float, default=2.5)
    next_review: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    created_at: Mapped[date] = mapped_column(Date, default=date.today, index=True)  # 首次学习日，用于每日新题上限

    puzzle: Mapped[Puzzle] = relationship(back_populates="review")


class Attempt(Base):
    """每次作答记录，用于统计与弱点分析。"""

    __tablename__ = "attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(40), default="default", index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    correct: Mapped[bool] = mapped_column(Boolean)
    time_spent_ms: Mapped[int] = mapped_column(Integer, default=0)
    wrong_move: Mapped[str] = mapped_column(String(10), default="")
    had_retry: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否中途重试，用于首答正确率


class Game(Base):
    """棋局复盘记录。"""

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(40), default="default", index=True)  # 棋局归属，匿名回退 default
    played_on: Mapped[str] = mapped_column(String(20), nullable=True)
    red_player: Mapped[str] = mapped_column(String(80), default="")
    black_player: Mapped[str] = mapped_column(String(80), default="")
    result: Mapped[str] = mapped_column(String(10), default="未知")
    moves: Mapped[str] = mapped_column(Text, default="")
    opening: Mapped[str] = mapped_column(String(80), default="")
    source: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    report: Mapped[str] = mapped_column(Text, default="")  # LLM 综合复盘报告（整局总评）


class GameAnalysis(Base):
    """棋局逐步引擎分析结果。"""

    __tablename__ = "game_analysis"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    move_index: Mapped[int] = mapped_column(Integer)          # 0-based，第几步
    fen_before: Mapped[str] = mapped_column(Text)              # 走这步前的局面
    move_played: Mapped[str] = mapped_column(String(10))       # 实际走法 UCI
    best_move: Mapped[str] = mapped_column(String(10), default="")  # 引擎最优
    score_cp: Mapped[int | None] = mapped_column(Integer, nullable=True)   # 走这步前评分（当前方视角）
    score_mate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eval_drop: Mapped[int] = mapped_column(Integer, default=0)  # 失分（正=失误）
    is_blunder: Mapped[bool] = mapped_column(Boolean, default=False)  # eval_drop > 200
    is_mistake: Mapped[bool] = mapped_column(Boolean, default=False)  # eval_drop > 80
    explanation: Mapped[str] = mapped_column(Text, default="")        # DeepSeek 解释
    puzzle_id: Mapped[int | None] = mapped_column(ForeignKey("puzzles.id"), nullable=True)


class UserStat(Base):
    """用户评分档案（每用户一行，按 user_id 字符串归属，含匿名 default）。

    与 User 表解耦：匿名访客也能有评分，且评分逻辑不依赖账号体系。
    """

    __tablename__ = "user_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    rating: Mapped[int] = mapped_column(Integer, default=1200)   # 当前 ELO
    peak: Mapped[int] = mapped_column(Integer, default=1200)     # 历史最高
    solved: Mapped[int] = mapped_column(Integer, default=0)      # 已结算评分的题数
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SecurityLog(Base):
    """安全审计日志：登录失败与管理员敏感操作，落库供后台查看。

    刻意只记录「谁、何时、从哪、做了什么」，绝不写入密码、token、API key 等敏感值。
    """

    __tablename__ = "security_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    level: Mapped[str] = mapped_column(String(10), default="info")   # info / warning
    event: Mapped[str] = mapped_column(String(40), index=True)       # login_failed / admin_action
    ip: Mapped[str] = mapped_column(String(45), default="-")
    actor: Mapped[str] = mapped_column(String(40), default="")       # 操作者 / 尝试登录的用户名
    action: Mapped[str] = mapped_column(String(40), default="")      # admin_action 的具体动作
    target: Mapped[str] = mapped_column(String(120), default="")


class AppSetting(Base):
    """运行时全局配置（键值对），供管理员在后台修改而无需重启或改环境变量。

    目前用于 AI 复盘（DeepSeek）的开关与密钥；DB 中的值优先于环境变量。
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
