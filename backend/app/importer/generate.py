"""一步杀题目生成器：随机布子 → 内置规则引擎校验 → 只留成立的「一步杀」。

针对「题库太少」的离线扩容手段，无需 Pikafish 或外部数据：
随机摆放红方攻子与黑方少量守子，要求双方都未被将军，再枚举红方着法，
凡能将死黑方者即为一道合格题。所有题都经 verify_mate 校验，保证正解成立。

用法（在 backend/ 目录）:
    python -m app.importer.generate --count 50 --out app/importer/generated.json
    python -m app.importer.load app/importer/generated.json   # 再导入
"""

from __future__ import annotations

import argparse
import json
import random

from .verify_mate import (
    FILES,
    ROWS,
    _apply,
    find_general,
    in_check,
    is_checkmate,
    legal_moves,
)

EMPTY: list[list[str | None]] = [[None] * 9 for _ in range(ROWS)]

# 红方攻子候选（不含将/帅，帅单独放）与黑方守子候选。
RED_ATTACKERS = ["R", "R", "C", "N", "P"]
BLACK_DEFENDERS = ["a", "a", "b", "n", "c"]


def _uci(r: int, c: int, tr: int, tc: int) -> str:
    return f"{FILES[c]}{9 - r}{FILES[tc]}{9 - tr}"


def _to_fen(board) -> str:
    rows = []
    for row in board:
        s, gap = "", 0
        for cell in row:
            if cell is None:
                gap += 1
            else:
                if gap:
                    s += str(gap)
                    gap = 0
                s += cell
        if gap:
            s += str(gap)
        rows.append(s or "9")
    return "/".join(rows) + " w"


def _palace_cells(side: str) -> list[tuple[int, int]]:
    rows = range(7, 10) if side == "w" else range(0, 3)
    return [(r, c) for r in rows for c in range(3, 6)]


def _random_position(rng: random.Random) -> list[list[str | None]] | None:
    board = [row[:] for row in EMPTY]
    occupied: set[tuple[int, int]] = set()

    def place(piece, cells):
        free = [c for c in cells if c not in occupied]
        if not free:
            return False
        r, c = rng.choice(free)
        board[r][c] = piece
        occupied.add((r, c))
        return True

    # 两将各居本方九宫
    if not place("K", _palace_cells("w")):
        return None
    if not place("k", _palace_cells("b")):
        return None

    all_cells = [(r, c) for r in range(ROWS) for c in range(9)]
    # 1-3 个红方攻子
    for _ in range(rng.randint(1, 3)):
        place(rng.choice(RED_ATTACKERS), all_cells)
    # 0-2 个黑方守子（多在黑半场，增加将死难度）
    for _ in range(rng.randint(0, 2)):
        place(rng.choice(BLACK_DEFENDERS), [(r, c) for (r, c) in all_cells if r <= 4])
    return board


def _difficulty(board, mate_count: int) -> int:
    """粗略难度：攻子越少、杀着越唯一越简单。"""
    attackers = sum(
        1 for row in board for p in row if p and p.isupper() and p != "K"
    )
    base = min(3, attackers)
    if mate_count == 1:
        base += 1  # 唯一解更需计算
    return max(1, min(5, base))


def generate(count: int, seed: int | None = None, max_tries: int = 200_000) -> list[dict]:
    rng = random.Random(seed)
    out: list[dict] = []
    seen: set[str] = set()
    tries = 0
    while len(out) < count and tries < max_tries:
        tries += 1
        board = _random_position(rng)
        if board is None:
            continue
        # 双方都不能已被将军（否则不是「找杀」题）
        if in_check(board, "w") or in_check(board, "b"):
            continue
        # 枚举红方着法，收集能将死黑方的
        mating = []
        for (r, c, tr, tc) in legal_moves(board, "w"):
            nb = _apply(board, r, c, tr, tc)
            if is_checkmate(nb, "b"):
                mating.append(_uci(r, c, tr, tc))
        if not mating:
            continue
        fen = _to_fen(board)
        if fen in seen:
            continue
        seen.add(fen)
        out.append(
            {
                "fen": fen,
                "solution": [mating[0]],
                "side_to_move": "w",
                "category": "实用残杀",
                "difficulty": _difficulty(board, len(mating)),
                "source": "generated",
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="生成内置规则校验过的一步杀题")
    ap.add_argument("--count", type=int, default=30)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default="app/importer/generated.json")
    args = ap.parse_args()

    puzzles = generate(args.count, seed=args.seed)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(puzzles, f, ensure_ascii=False, indent=2)
    print(f"已生成 {len(puzzles)} 道一步杀题 → {args.out}")


if __name__ == "__main__":
    main()
