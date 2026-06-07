"""人机对弈引擎。

合法着法生成 / 局面状态判定复用 importer.verify_mate 的规则实现；
走子选择优先用 Pikafish，未安装时回退到内置的 negamax + alpha-beta 搜索，
保证对弈功能开箱即用。
"""

from __future__ import annotations

from .importer.verify_mate import (
    FILES,
    _apply,
    find_general,
    in_check,
    legal_moves,
    parse_fen,
)

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

# 子力价值（centipawn），红正黑负在 evaluate 中按方处理
VALUE = {"R": 900, "N": 400, "C": 450, "P": 100, "A": 200, "B": 200, "K": 100000}


def _rc(r: int, c: int) -> str:
    return FILES[c] + str(9 - r)


def _mv_uci(m) -> str:
    r, c, tr, tc = m
    return _rc(r, c) + _rc(tr, tc)


def side_to_move(fen: str) -> str:
    parts = fen.split()
    return parts[1] if len(parts) > 1 else "w"


def legal_moves_uci(fen: str) -> list[str]:
    board = parse_fen(fen)
    return [_mv_uci(m) for m in legal_moves(board, side_to_move(fen))]


def game_status(fen: str) -> str:
    """返回当前走子方的局面状态：checkmate / stalemate / check / ongoing。"""
    board = parse_fen(fen)
    side = side_to_move(fen)
    moves = legal_moves(board, side)
    checked = in_check(board, side)
    if not moves:
        return "checkmate" if checked else "stalemate"
    return "check" if checked else "ongoing"


def _crossed_river(row: int, red: bool) -> bool:
    return row <= 4 if red else row >= 5


def evaluate(board) -> int:
    """红方视角静态评估（正=红优）。子力 + 少量位置分。"""
    score = 0
    for r in range(10):
        for c in range(9):
            p = board[r][c]
            if p is None:
                continue
            red = p.isupper()
            base = VALUE[p.upper()]
            sign = 1 if red else -1
            score += sign * base
            # 过河兵加分
            if p.upper() == "P" and _crossed_river(r, red):
                score += sign * 80
            # 车马炮靠中心略加分
            if p.upper() in ("R", "N", "C"):
                score += sign * (4 - abs(c - 4))
    return score


def _negamax(board, side: str, depth: int, alpha: int, beta: int) -> int:
    """negamax + alpha-beta，返回当前走子方视角的分值。"""
    moves = legal_moves(board, side)
    if not moves:
        # 无着：被将死给极负分，困毙按 0
        return -1000000 if in_check(board, side) else 0
    if depth == 0:
        sign = 1 if side == "w" else -1
        return sign * evaluate(board)

    # 着法排序：吃子优先（提升剪枝效率）
    def cap_value(m):
        tgt = board[m[2]][m[3]]
        return VALUE[tgt.upper()] if tgt else 0

    moves.sort(key=cap_value, reverse=True)

    opp = "b" if side == "w" else "w"
    best = -1000000000
    for m in moves:
        val = -_negamax(_apply(board, *m), opp, depth - 1, -beta, -alpha)
        if val > best:
            best = val
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
    return best


def _builtin_best_move(fen: str, depth: int) -> str | None:
    board = parse_fen(fen)
    side = side_to_move(fen)
    moves = legal_moves(board, side)
    if not moves:
        return None

    def cap_value(m):
        tgt = board[m[2]][m[3]]
        return VALUE[tgt.upper()] if tgt else 0

    moves.sort(key=cap_value, reverse=True)

    opp = "b" if side == "w" else "w"
    best_move = moves[0]
    best_val = -1000000000
    alpha, beta = -1000000000, 1000000000
    for m in moves:
        val = -_negamax(_apply(board, *m), opp, depth - 1, -beta, -alpha)
        if val > best_val:
            best_val = val
            best_move = m
        if best_val > alpha:
            alpha = best_val
    return _mv_uci(best_move)


# 难度 -> 内置搜索深度
DEPTH = {"easy": 1, "medium": 2, "hard": 3}


def choose_move(fen: str, level: str = "medium") -> str | None:
    """为当前走子方选择一着。优先 Pikafish，否则内置搜索。"""
    from .engine import get_engine

    engine = get_engine()
    if engine is not None:
        try:
            depth = {"easy": 6, "medium": 12, "hard": 18}.get(level, 12)
            ev = engine.analyze(fen, depth=depth)
            if ev.best_move:
                return ev.best_move
        except Exception:
            pass
        finally:
            try:
                engine.close()
            except Exception:
                pass
    return _builtin_best_move(fen, DEPTH.get(level, 2))
