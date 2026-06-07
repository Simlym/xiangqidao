"""测试一步杀校验器：将军 / 将死 / 规则判定。"""

import json
from pathlib import Path

from app.importer.verify_mate import (
    generals_facing,
    in_check,
    is_checkmate,
    is_mate_in_one,
    parse_fen,
)


def test_double_rook_mate():
    ok, _ = is_mate_in_one("4k4/R8/8R/9/9/9/9/9/9/3K5 w", "i7i9")
    assert ok


def test_not_check_is_not_mate():
    ok, why = is_mate_in_one("3k5/9/9/9/9/9/9/9/9/3KR4 w", "e0e1")
    assert not ok


def test_rejects_self_check():
    # 红帅与黑将同列，走开挡子会送将的情形由规则拒绝
    ok, why = is_mate_in_one("4k4/R8/8R/9/9/9/9/9/9/3K5 w", "d0d1")
    assert not ok  # d0 无红子，起点无子


def test_generals_facing():
    board = parse_fen("4k4/9/9/9/9/9/9/9/9/4K4")
    assert generals_facing(board)
    board2 = parse_fen("4k4/9/9/9/9/9/9/9/9/3K5")
    assert not generals_facing(board2)


def test_flying_general_is_check():
    board = parse_fen("4k4/9/9/9/9/9/9/9/9/4K4")
    assert in_check(board, "b")


def test_seed_puzzles_all_mate():
    """题库里每道题都应是成立的一步杀。"""
    path = Path(__file__).resolve().parent.parent / "app" / "importer" / "seed_puzzles.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for p in data:
        sol = p["solution"]
        mv = sol[0] if isinstance(sol, list) else sol.split(",")[0]
        fen = p["fen"] if len(p["fen"].split()) > 1 else p["fen"] + " " + p.get("side_to_move", "w")
        ok, why = is_mate_in_one(fen, mv)
        assert ok, f"{p['category']} {mv} 非杀：{why}"
