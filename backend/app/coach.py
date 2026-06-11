"""AI 教练：汇总用户数据，生成阶段性训练计划。

设计原则：事实与训练建议由规则引擎从既有数据（ELO 评分、首答正确率、
弱点雷达、对局分析失误、实战漏算题）**确定性**产出；LLM 只负责把这些
事实写成教练口吻的教学叙述。未配置大模型时计划依然可用（纯数据版）。

每局对弈分析完成后自动刷新计划（见 routes/analysis.py），用户也可在
「AI 教练」页手动更新——形成「对局 → 复盘 → 画像 → 计划 → 针对训练」闭环。
"""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy.orm import Session

from . import elo, repository as repo
from .llm import write_coach_plan
from .models import CoachPlan, Game, GameAnalysis, Puzzle, Review
from .settings import get_deepseek_config

# 弱点判定：作答数达到下限且正确率低于阈值的类目
WEAK_MIN_ATTEMPTS = 3
WEAK_ACC = 0.7


def build_profile(db: Session, user: str) -> dict:
    """汇总用户画像：水平、状态、弱点、近期对局失误概况。"""
    stat = repo.get_user_stat(db, user)
    rating = stat.rating if stat else 1200

    total_att, _, first_try_att = repo.attempt_totals(db, user)
    recent = repo.recent_attempts(db, user, limit=20)
    recent_first = sum(1 for c, r in recent if c and not r)

    weak: list[dict] = []
    for cat, n, c in repo.category_stats(db, user):
        c = c or 0
        if n >= WEAK_MIN_ATTEMPTS and c / n < WEAK_ACC:
            weak.append({"category": cat, "attempts": n, "accuracy": round(c / n, 2)})
    weak.sort(key=lambda w: w["accuracy"])

    # 近 5 局中已有分析结果的对局：失误画像（严重失误/失误数）
    games = (
        db.query(Game)
        .filter(Game.user_id == user)
        .order_by(Game.id.desc())
        .limit(5)
        .all()
    )
    recent_games: list[dict] = []
    for g in games:
        rows = db.query(GameAnalysis).filter(GameAnalysis.game_id == g.id).all()
        if not rows:
            continue
        recent_games.append(
            {
                "game_id": g.id,
                "result": g.result,
                "moves": len(rows),
                "blunders": sum(1 for r in rows if r.is_blunder),
                "mistakes": sum(1 for r in rows if r.is_mistake and not r.is_blunder),
            }
        )

    # 实战漏算生成、还没练过的私有题
    practiced = {pid for (pid,) in db.query(Review.puzzle_id).filter(Review.user_id == user)}
    blunder_ids = [
        pid
        for (pid,) in db.query(Puzzle.id).filter(
            Puzzle.user_id == user, Puzzle.category == "实战漏算"
        )
    ]
    pending_blunder = sum(1 for pid in blunder_ids if pid not in practiced)

    return {
        "rating": rating,
        "title": elo.rank_title(rating),
        "peak": stat.peak if stat else 1200,
        "solved": stat.solved if stat else 0,
        "due_today": repo.count_due(db, user, date.today()),
        "total_attempts": total_att,
        "first_try_accuracy": round(first_try_att / total_att, 2) if total_att else None,
        "recent20_first_try_accuracy": round(recent_first / len(recent), 2) if recent else None,
        "weak_categories": weak[:3],
        "recent_games": recent_games,
        "pending_blunder_puzzles": pending_blunder,
    }


def build_recommendations(profile: dict) -> list[dict]:
    """规则引擎：按优先级把画像转成可执行的训练建议（前端渲染成行动按钮）。

    rec.type: review=到期复习 / category=专项练习 / play=人机对弈 / train=常规训练
    """
    recs: list[dict] = []
    if profile["due_today"]:
        recs.append(
            {
                "type": "review",
                "count": profile["due_today"],
                "reason": "到期复习优先——间隔重复是把杀法刻进直觉的关键，过期堆积会前功尽弃",
            }
        )
    if profile["pending_blunder_puzzles"]:
        recs.append(
            {
                "type": "category",
                "category": "实战漏算",
                "count": profile["pending_blunder_puzzles"],
                "reason": "从你实战漏着自动生成的题，错过的局面再练一遍，针对性最强",
            }
        )
    for w in profile["weak_categories"][:2]:
        recs.append(
            {
                "type": "category",
                "category": w["category"],
                "reason": f"「{w['category']}」正确率仅 {round(w['accuracy'] * 100)}%（{w['attempts']} 次作答），建议集中突破",
            }
        )
    if not profile["recent_games"]:
        recs.append(
            {
                "type": "play",
                "reason": "下一盘人机对弈检验训练成果，对局结束自动复盘分析、更新你的画像",
            }
        )
    if not recs:
        recs.append(
            {
                "type": "train",
                "reason": "当前没有明显短板与积压任务，按每日节奏继续训练新题即可",
            }
        )
    return recs


def generate_plan(db: Session, user: str, trigger: str = "manual") -> CoachPlan:
    """生成并保存一份训练计划；LLM 可用时附教练叙述。"""
    profile = build_profile(db, user)
    recs = build_recommendations(profile)
    text = ""
    if get_deepseek_config(db).active:
        text = write_coach_plan(profile, recs)
    plan = CoachPlan(
        user_id=user,
        trigger=trigger,
        profile_json=json.dumps(profile, ensure_ascii=False),
        recommendations_json=json.dumps(recs, ensure_ascii=False),
        plan_text=text,
    )
    db.add(plan)
    db.commit()
    return plan
