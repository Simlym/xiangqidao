"""ELO 评分 + 闯关体系测试。"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import elo, ratings
from app import repository as repo
from app.models import Base, Puzzle
from app.routes.challenge import (
    ChallengeSubmitRequest,
    get_level,
    list_levels,
    submit as challenge_submit,
)
from app.routes.stats import leaderboard, rating as rating_overview

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False)


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _seed_public_puzzles(db, n=14):
    """造 n 道公共题，难度循环 1-5，方便切分关卡。"""
    for i in range(n):
        diff = (i % 5) + 1
        db.add(
            Puzzle(
                fen=f"fen{i}",
                solution="h2e2",
                side_to_move="w",
                category="test",
                difficulty=diff,
                rating=elo.difficulty_to_rating(diff),
                user_id="default",
            )
        )
    db.commit()


# ── 纯 ELO 数学 ─────────────────────────────────────────────────

def test_difficulty_to_rating_monotonic():
    vals = [elo.difficulty_to_rating(d) for d in range(1, 6)]
    assert vals == sorted(vals)
    assert vals[0] == 800 and vals[-1] == 1800


def test_expected_score_symmetry():
    assert elo.expected_score(1500, 1500) == pytest.approx(0.5)
    assert elo.expected_score(2000, 1000) > 0.9


def test_winning_raises_losing_lowers():
    up, _ = elo.update_ratings(1200, 1300, score=1.0, solved=0)
    down, _ = elo.update_ratings(1200, 1300, score=0.0, solved=0)
    assert up > 1200 > down


def test_puzzle_rating_moves_opposite():
    # 用户做对（强于预期）→ 题目应降分
    _, new_puzzle = elo.update_ratings(1500, 1500, score=1.0, solved=50)
    assert new_puzzle < 1500


def test_rank_title_bands():
    assert elo.rank_title(2300) == "棋圣"
    assert elo.rank_title(1200) == "中级棋手"
    assert elo.rank_title(500) == "象棋新手"


# ── 评分结算服务 ────────────────────────────────────────────────

def test_apply_rates_logged_in_user(db):
    p = Puzzle(fen="x", solution="h2e2", difficulty=3, rating=1300, user_id="default")
    db.add(p)
    db.commit()
    res = ratings.apply(db, "alice", p, ratings.score_of(correct=True, had_retry=False))
    assert res is not None and res["delta"] > 0
    stat = repo.get_user_stat(db, "alice")
    assert stat.rating == res["new"] and stat.solved == 1


def test_apply_skips_guest(db):
    p = Puzzle(fen="x", solution="h2e2", difficulty=3, rating=1300, user_id="default")
    db.add(p)
    db.commit()
    assert ratings.apply(db, "default", p, 1.0) is None


def test_score_of_grades():
    assert ratings.score_of(True, False) == 1.0
    assert ratings.score_of(True, True) == 0.5
    assert ratings.score_of(False, False) == 0.0


# ── 闯关 ────────────────────────────────────────────────────────

def test_levels_chunk_and_lock(db):
    _seed_public_puzzles(db, 14)  # 6+6+2 → 3 关
    levels = list_levels(db=db, user="alice")
    assert len(levels) == 3
    # 仅第一关解锁，且都未通关
    assert levels[0].unlocked and not levels[1].unlocked
    assert all(not lv.cleared for lv in levels)


def test_locked_level_detail_forbidden(db):
    _seed_public_puzzles(db, 14)
    with pytest.raises(HTTPException) as exc:
        get_level(1, db=db, user="alice")
    assert exc.value.status_code == 403


def test_clearing_unlocks_next_and_awards_stars(db):
    _seed_public_puzzles(db, 12)  # 2 关
    detail = get_level(0, db=db, user="alice")
    for lp in detail.puzzles:
        challenge_submit(
            ChallengeSubmitRequest(puzzle_id=lp.id, correct=True, had_retry=False),
            db=db,
            user="alice",
        )
    levels = list_levels(db=db, user="alice")
    assert levels[0].cleared and levels[0].stars == 3
    assert levels[1].unlocked  # 通关后下一关解锁
    # 现在可进入第二关
    assert get_level(1, db=db, user="alice").index == 1


def test_retry_reduces_stars(db):
    _seed_public_puzzles(db, 6)  # 1 关
    detail = get_level(0, db=db, user="alice")
    for i, lp in enumerate(detail.puzzles):
        challenge_submit(
            ChallengeSubmitRequest(puzzle_id=lp.id, correct=True, had_retry=(i % 2 == 0)),
            db=db,
            user="alice",
        )
    levels = list_levels(db=db, user="alice")
    assert levels[0].cleared
    assert levels[0].stars < 3  # 有重试，拿不到满星


# ── 评分概览 / 排行榜 ───────────────────────────────────────────

def test_rating_overview_and_leaderboard(db):
    _seed_public_puzzles(db, 6)
    detail = get_level(0, db=db, user="alice")
    for lp in detail.puzzles:
        challenge_submit(
            ChallengeSubmitRequest(puzzle_id=lp.id, correct=True),
            db=db,
            user="alice",
        )
    ov = rating_overview(db=db, user="alice")
    assert ov.solved == 6 and ov.rating > 1200 and ov.title

    board = leaderboard(limit=10, db=db, user="alice")
    assert board and board[0].username == "alice" and board[0].is_me
    # 匿名 default 不进榜
    assert all(r.username != "default" for r in board)


def test_rating_settled_once_per_puzzle(db):
    p = Puzzle(fen="x", solution="h2e2", difficulty=3, rating=1300, user_id="default")
    db.add(p)
    db.commit()
    r1 = challenge_submit(ChallengeSubmitRequest(puzzle_id=p.id, correct=True), db=db, user="bob")
    assert r1.rating is not None
    r2 = challenge_submit(ChallengeSubmitRequest(puzzle_id=p.id, correct=True), db=db, user="bob")
    assert r2.rating is None  # 二次作答不再结算
