"""数据模型。单用户场景，user_id 暂以固定值占位，便于日后扩展多用户。"""

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
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


class Base(DeclarativeBase):
    pass


class Puzzle(Base):
    """战术题。solution 为正解着法序列，UCI 坐标制，逗号分隔，如 'h2e2,a9a8'。"""

    __tablename__ = "puzzles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fen: Mapped[str] = mapped_column(String(120), nullable=False)
    solution: Mapped[str] = mapped_column(Text, nullable=False)
    side_to_move: Mapped[str] = mapped_column(String(1), default="w")  # w=红 b=黑
    category: Mapped[str] = mapped_column(String(40), default="未分类")  # 杀法类型
    difficulty: Mapped[int] = mapped_column(Integer, default=3)         # 1-5
    source: Mapped[str] = mapped_column(String(80), default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)      # 是否经引擎校验

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


class Game(Base):
    """棋局复盘记录。"""

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    played_on: Mapped[str] = mapped_column(String(20), nullable=True)
    red_player: Mapped[str] = mapped_column(String(80), default="")
    black_player: Mapped[str] = mapped_column(String(80), default="")
    result: Mapped[str] = mapped_column(String(10), default="未知")
    moves: Mapped[str] = mapped_column(Text, default="")
    opening: Mapped[str] = mapped_column(String(80), default="")
    source: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")


DB_URL = "sqlite:///./data/puzzles.db"
engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False)


def init_db() -> None:
    Base.metadata.create_all(engine)
