"""统一学习画像、内容地图、阶段测评与复盘训练包。"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user_id
from ..deps import get_db
from ..models import Attempt, Game, GameAnalysis, LearningPack, Puzzle

router = APIRouter(prefix="/api/learning", tags=["learning"])

CURRICULUM = {
    "杀法": {"goal": "识别将死网络与连续先手", "skills": ["将军次序", "封锁逃路", "子力配合"]},
    "开局": {"goal": "高效出子并保持阵形协调", "skills": ["出子效率", "中心控制", "王的安全"]},
    "中局": {"goal": "比较候选着并处理攻守转换", "skills": ["先手", "交换判断", "薄弱点"]},
    "残局": {"goal": "把局面优势转化为可计算结果", "skills": ["兵卒速度", "将帅位置", "兑子原则"]},
}


def _tags(puzzle: Puzzle) -> list[tuple[str, str]]:
    values = [("kind", puzzle.kind or "杀法"), ("category", puzzle.category or "未分类")]
    values += [("tag", tag.strip()) for tag in (puzzle.tags or "").split(",") if tag.strip()]
    return values


def _attempt_rows(db: Session, user: str):
    return db.execute(
        select(Attempt, Puzzle).join(Puzzle, Puzzle.id == Attempt.puzzle_id)
        .where(Attempt.user_id == user).order_by(Attempt.ts, Attempt.id)
    ).all()


def _summary(rows) -> dict:
    if not rows:
        return {"attempts": 0, "accuracy": 0.0, "first_try_accuracy": 0.0, "avg_seconds": 0.0}
    first_by_puzzle = {}
    for attempt, _ in rows:
        first_by_puzzle.setdefault(attempt.puzzle_id, attempt)
    return {
        "attempts": len(rows),
        "accuracy": round(sum(a.correct for a, _ in rows) / len(rows), 3),
        "first_try_accuracy": round(sum(a.correct and not a.had_retry for a in first_by_puzzle.values()) / len(first_by_puzzle), 3),
        "avg_seconds": round(sum(max(0, a.time_spent_ms) for a, _ in rows) / len(rows) / 1000, 1),
    }


@router.get("/curriculum")
def curriculum(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    visible = db.scalars(select(Puzzle).where((Puzzle.user_id == "default") | (Puzzle.user_id == user))).all()
    grouped = defaultdict(list)
    for puzzle in visible:
        grouped[puzzle.kind or "杀法"].append(puzzle)
    return [{
        "kind": kind, **definition, "total": len(grouped[kind]),
        "categories": sorted({p.category or "未分类" for p in grouped[kind]}),
        "available": bool(grouped[kind]),
    } for kind, definition in CURRICULUM.items()]


@router.get("/mastery")
def mastery(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    buckets = defaultdict(list)
    for attempt, puzzle in _attempt_rows(db, user):
        for tag_type, name in _tags(puzzle):
            buckets[(tag_type, name)].append(attempt)
    result = []
    for (tag_type, name), attempts in buckets.items():
        recent = attempts[-12:]
        weighted = [1.0 if a.correct and not a.had_retry else 0.65 if a.correct else 0.0 for a in recent]
        seen_success = False
        recurrence = opportunities = 0
        contexts = defaultdict(int)
        for attempt in attempts:
            contexts[attempt.context or "training"] += 1
            if seen_success:
                opportunities += 1
                if not attempt.correct:
                    recurrence += 1
            if attempt.correct:
                seen_success = True
        result.append({
            "type": tag_type, "name": name, "attempts": len(attempts),
            "mastery": round(sum(weighted) / len(weighted) * 100) if weighted else 0,
            "recurrence_rate": round(recurrence / opportunities, 3) if opportunities else 0.0,
            "contexts": dict(contexts),
        })
    return sorted(result, key=lambda x: (x["mastery"], -x["attempts"]))


@router.get("/progress")
def progress(days: int = 28, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    period = max(14, min(days, 180))
    now = datetime.utcnow()
    since = now - timedelta(days=period)
    rows = [(a, p) for a, p in _attempt_rows(db, user) if a.ts >= since]
    midpoint = since + (now - since) / 2
    before, after = [(a, p) for a, p in rows if a.ts < midpoint], [(a, p) for a, p in rows if a.ts >= midpoint]
    b, a = _summary(before), _summary(after)
    return {
        "period_days": period, "before": b, "after": a,
        "accuracy_delta": round(a["first_try_accuracy"] - b["first_try_accuracy"], 3),
        "speed_delta_seconds": round(b["avg_seconds"] - a["avg_seconds"], 1),
        "enough_data": b["attempts"] >= 3 and a["attempts"] >= 3,
    }


class PackOut(BaseModel):
    id: str
    type: str
    title: str
    puzzle_ids: list[int]
    completed: bool
    baseline: dict


def _pack_out(pack: LearningPack) -> PackOut:
    return PackOut(id=pack.id, type=pack.pack_type, title=pack.title,
                   puzzle_ids=json.loads(pack.puzzle_ids_json or "[]"),
                   completed=pack.completed_at is not None,
                   baseline=json.loads(pack.baseline_json or "{}"))


@router.post("/assessment/start", response_model=PackOut)
def start_assessment(db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    baseline = _summary(_attempt_rows(db, user)[-20:])
    puzzles = db.scalars(select(Puzzle).where(Puzzle.user_id == "default").order_by(Puzzle.kind, Puzzle.difficulty, Puzzle.id)).all()
    by_kind = defaultdict(list)
    for puzzle in puzzles:
        by_kind[puzzle.kind or "杀法"].append(puzzle)
    selected = []
    for kind in CURRICULUM:
        selected.extend(by_kind[kind][:2])
    used = {p.id for p in selected}
    selected.extend([p for p in puzzles if p.id not in used][:8 - len(selected)])
    if not selected:
        raise HTTPException(409, "题库暂无可用于测评的题目")
    pack = LearningPack(id=uuid4().hex, user_id=user, pack_type="assessment", title="阶段测评",
                        puzzle_ids_json=json.dumps([p.id for p in selected[:8]]),
                        baseline_json=json.dumps(baseline, ensure_ascii=False))
    db.add(pack)
    db.commit()
    return _pack_out(pack)


@router.post("/games/{game_id}/pack", response_model=PackOut)
def game_pack(game_id: int, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    game = db.get(Game, game_id)
    if not game or game.user_id != user:
        raise HTTPException(404, "棋局不存在")
    existing = db.scalar(select(LearningPack).where(LearningPack.user_id == user,
        LearningPack.pack_type == "game_review", LearningPack.source_game_id == game_id))
    if existing:
        return _pack_out(existing)
    analyses = db.scalars(select(GameAnalysis).where(GameAnalysis.game_id == game_id,
        GameAnalysis.puzzle_id.is_not(None)).order_by(GameAnalysis.eval_drop.desc()).limit(3)).all()
    ids = [a.puzzle_id for a in analyses if a.puzzle_id]
    if not ids:
        raise HTTPException(409, "本局尚未生成关键问题，请先完成复盘分析")
    pack = LearningPack(id=uuid4().hex, user_id=user, pack_type="game_review", title="本局 3 个关键问题",
                        source_game_id=game_id, puzzle_ids_json=json.dumps(ids), baseline_json="{}")
    db.add(pack)
    db.commit()
    return _pack_out(pack)


@router.get("/packs/{pack_id}", response_model=PackOut)
def get_pack(pack_id: str, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    pack = db.get(LearningPack, pack_id)
    if not pack or pack.user_id != user:
        raise HTTPException(404, "训练包不存在")
    return _pack_out(pack)


@router.post("/packs/{pack_id}/complete")
def complete_pack(pack_id: str, db: Session = Depends(get_db), user: str = Depends(current_user_id)):
    pack = db.get(LearningPack, pack_id)
    if not pack or pack.user_id != user:
        raise HTTPException(404, "训练包不存在")
    ids = json.loads(pack.puzzle_ids_json or "[]")
    context = f"{pack.pack_type}:{pack.id}"
    attempts = db.scalars(select(Attempt).where(Attempt.user_id == user, Attempt.context == context,
        Attempt.puzzle_id.in_(ids), Attempt.ts >= pack.created_at)).all()
    if not all(pid in {a.puzzle_id for a in attempts} for pid in ids):
        raise HTTPException(409, "训练包尚未全部完成")
    pack.completed_at = datetime.utcnow()
    first_attempts = {}
    for attempt in sorted(attempts, key=lambda item: (item.ts, item.id)):
        first_attempts.setdefault(attempt.puzzle_id, attempt)
    score = round(sum(a.correct and not a.had_retry for a in first_attempts.values()) / len(ids), 3) if ids else 0.0
    baseline = json.loads(pack.baseline_json or "{}")
    db.commit()
    return {"completed": True, "score": score,
            "baseline_accuracy": baseline.get("first_try_accuracy", 0.0),
            "delta": round(score - baseline.get("first_try_accuracy", 0.0), 3)}
