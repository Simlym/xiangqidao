"""题库质量审计、去重、唯一解检查与难度校准。

默认审计 wukong_puzzles.json，输出：
- wukong_puzzles.audited.json：剔除非法/重复局面并校准难度后的可导入题库；
- puzzle_audit_report.md：人可读质量报告。
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from .solver import FILES, _attacker_mate_in, _opp, _uci
from .verify_mate import _apply, in_check, is_checkmate, legal_moves, parse_fen

PIECE_LIMITS = {"K": 1, "A": 2, "B": 2, "N": 2, "R": 2, "C": 2, "P": 5}


def _strict_position(fen: str) -> tuple[bool, str]:
    parts = fen.split()
    if len(parts) < 2 or parts[1] not in ("w", "b"):
        return False, "缺少合法走子方"
    rows = parts[0].split("/")
    if len(rows) != 10:
        return False, "棋盘行数不是10"
    allowed = set("KABNRCPkabnrcp123456789")
    for row in rows:
        if any(ch not in allowed for ch in row):
            return False, "包含未知棋子字符"
        width = sum(int(ch) if ch.isdigit() else 1 for ch in row)
        if width != 9:
            return False, "棋盘列数不是9"
    board = parse_fen(fen)
    flat = [p for row in board for p in row if p]
    if flat.count("K") != 1 or flat.count("k") != 1:
        return False, "帅将数量不为各1"
    for side in (str.upper, str.lower):
        for piece, limit in PIECE_LIMITS.items():
            if flat.count(side(piece)) > limit:
                return False, f"{side(piece)}数量超限"
    for king, row_range in (("K", range(7, 10)), ("k", range(0, 3))):
        pos = next((rc for rc in ((r, c) for r in range(10) for c in range(9)) if board[rc[0]][rc[1]] == king), None)
        if pos is None or pos[0] not in row_range or pos[1] not in range(3, 6):
            return False, "帅将不在九宫"
    return True, ""


def _solution_valid(fen: str, solution: list[str]) -> tuple[bool, str]:
    if not solution:
        return False, "解答为空"
    board = parse_fen(fen)
    side = fen.split()[1]
    for index, move in enumerate(solution):
        if len(move) < 4 or move[0] not in FILES or move[2] not in FILES or not move[1].isdigit() or not move[3].isdigit():
            return False, f"第{index + 1}手格式错误"
        legal = {_uci(*item): item for item in legal_moves(board, side)}
        if move[:4] not in legal:
            return False, f"第{index + 1}手非法"
        board = _apply(board, *legal[move[:4]])
        side = _opp(side)
    if not is_checkmate(board, side):
        return False, "主变终点不是将死"
    return True, ""


def _winning_first_moves(fen: str, moves_left: int, expected: str) -> list[str]:
    """搜索给定深度内所有连续将军强制杀首着；找到第二解后仍继续以产出准确计数。"""
    board = parse_fen(fen)
    side = fen.split()[1]
    opponent = _opp(side)
    winners: list[str] = []
    ordered = sorted(legal_moves(board, side), key=lambda m: 0 if _uci(*m) == expected else 1)
    for move in ordered:
        next_board = _apply(board, *move)
        if not in_check(next_board, opponent):
            continue
        won = is_checkmate(next_board, opponent)
        if not won and moves_left > 1:
            replies = legal_moves(next_board, opponent)
            won = bool(replies) and all(
                _attacker_mate_in(_apply(next_board, *reply), side, moves_left - 1) is not None
                for reply in replies
            )
        if won:
            winners.append(_uci(*move))
    return winners


def _difficulty(steps: int, legal_count: int, solution_count: int) -> int:
    value = max(1, min(5, steps))
    if solution_count == 1 and legal_count >= 18:
        value += 1
    if solution_count > 1:
        value -= 1
    return max(1, min(5, value))


def audit(items: list[dict]) -> tuple[list[dict], dict]:
    seen_positions: set[str] = set()
    cleaned: list[dict] = []
    invalid = Counter()
    duplicate_positions = 0
    multiple_solution = 0
    unique_solution = 0
    calibrated = 0
    solution_distribution = Counter()

    for item in items:
        fen = " ".join(str(item.get("fen", "")).split())
        position_key = " ".join(fen.split()[:2])
        if position_key in seen_positions:
            duplicate_positions += 1
            continue
        ok, reason = _strict_position(fen)
        if not ok:
            invalid[reason] += 1
            continue
        solution = item.get("solution") or []
        if isinstance(solution, str):
            solution = [m.strip() for m in solution.split(",") if m.strip()]
        ok, reason = _solution_valid(fen, solution)
        if not ok:
            invalid[reason] += 1
            continue

        steps = (len(solution) + 1) // 2
        winners = _winning_first_moves(fen, steps, solution[0][:4])
        if not winners:
            invalid["未搜索到同深度强制杀"] += 1
            continue
        if len(winners) == 1:
            unique_solution += 1
        else:
            multiple_solution += 1
        solution_distribution[len(winners)] += 1

        legal_count = len(legal_moves(parse_fen(fen), fen.split()[1]))
        next_item = dict(item)
        next_item["fen"] = fen
        next_item["solution"] = solution
        next_item["steps"] = steps
        next_difficulty = _difficulty(steps, legal_count, len(winners))
        if next_difficulty != int(item.get("difficulty") or 0):
            calibrated += 1
        next_item["difficulty"] = next_difficulty
        next_item["verified"] = True
        next_item["solution_count"] = len(winners)
        seen_positions.add(position_key)
        cleaned.append(next_item)

    report = {
        "input": len(items),
        "output": len(cleaned),
        "duplicate_positions": duplicate_positions,
        "invalid_total": sum(invalid.values()),
        "invalid_reasons": dict(invalid.most_common()),
        "unique_solution": unique_solution,
        "multiple_solution": multiple_solution,
        "difficulty_calibrated": calibrated,
        "solution_count_distribution": dict(sorted(solution_distribution.items())),
        "difficulty_distribution": dict(sorted(Counter(p["difficulty"] for p in cleaned).items())),
        "category_distribution": dict(Counter(p.get("category", "未分类") for p in cleaned).most_common()),
    }
    return cleaned, report


def _markdown(source: Path, report: dict) -> str:
    reasons = "\n".join(f"- {name}: {count}" for name, count in report["invalid_reasons"].items()) or "- 无"
    return f"""# 题库质量审计报告

- 源文件：`{source.name}`
- 输入题数：{report['input']}
- 清洗后题数：{report['output']}
- 重复局面：{report['duplicate_positions']}
- 非法/无效题：{report['invalid_total']}
- 唯一首着解：{report['unique_solution']}
- 多首着解：{report['multiple_solution']}
- 难度被重新标定：{report['difficulty_calibrated']}

## 无效原因

{reasons}

## 难度分布

`{json.dumps(report['difficulty_distribution'], ensure_ascii=False)}`

## 首着解数量分布

`{json.dumps(report['solution_count_distribution'], ensure_ascii=False)}`

## 校准规则

基础难度取强制杀步数（1–5）；唯一解且合法候选着不少于 18 时上调一级；同深度存在多个强制杀首着时下调一级。所有保留题均通过严格 FEN、逐手合法性和终局将死检查。
"""


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=here / "wukong_puzzles.json")
    parser.add_argument("--output", type=Path, default=here / "wukong_puzzles.audited.json")
    parser.add_argument("--report", type=Path, default=here / "puzzle_audit_report.md")
    args = parser.parse_args()

    items = json.loads(args.input.read_text(encoding="utf-8"))
    cleaned, report = audit(items)
    args.output.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    args.report.write_text(_markdown(args.input, report), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
