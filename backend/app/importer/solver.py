"""杀法求解与自动分类。

复用 verify_mate 的纯 Python 规则引擎，无需 Pikafish：

- solve_mate(fen, max_moves)：在给定局面下搜索「强制将杀」，返回一条主变着法
  序列（UCI 坐标制，己方/对方交替）。用于给只有局面、没有题解的外部题库
  （如世界大赛实战杀局）补出正解。
- classify(fen, solution)：依据将死局面与最后一手，启发式识别常见杀法名目
  （卧槽马、马后炮、双车错、对面笑、闷宫……），给题目打分类标签。

「强制将杀」定义：己方每一手都将军，且对方任一合法应着都无法逃脱，最终被将死。
返回的主变里，对方应着取「使被杀步数最大」的一手（标准 mate-search 输出），
保证这条线确实走到将死——契合本系统「题解为单一线性序列、对方应着由系统自动
走出」的做题流程。
"""

from __future__ import annotations

from .verify_mate import (
    FILES,
    _apply,
    in_check,
    is_checkmate,
    legal_moves,
    parse_fen,
    side_of,
)


def _uci(r: int, c: int, tr: int, tc: int) -> str:
    return f"{FILES[c]}{9 - r}{FILES[tc]}{9 - tr}"


def _opp(side: str) -> str:
    return "b" if side == "w" else "w"


def _attacker_mate_in(board, side: str, moves_left: int):
    """己方(side)能否在 moves_left 步内强制将死对方；返回主变 [(r,c,tr,tc)…] 或 None。

    主变交替排列：己方着、对方应着、己方着……以将死结束。
    只搜索「将军着」以保持分支极小（杀棋本质是连续将军），保证纯 Python 下足够快。
    """
    opp = _opp(side)
    best: list[tuple[int, int, int, int]] | None = None
    for (r, c, tr, tc) in legal_moves(board, side):
        nb = _apply(board, r, c, tr, tc)
        # 杀棋每一手都必须是将军（含闷杀这类，将军后对方无着）
        if not in_check(nb, opp):
            continue
        if is_checkmate(nb, opp):
            # 本手即将死：最短解，立即采用
            return [(r, c, tr, tc)]
        if moves_left <= 1:
            continue
        # 对方须有应着（否则上面已将死）；要求每个应着都能在剩余步数内被将死
        line_for_this = [(r, c, tr, tc)]
        ok = True
        worst_reply_line: list | None = None
        for (rr, rc, rtr, rtc) in legal_moves(nb, opp):
            rb = _apply(nb, rr, rc, rtr, rtc)
            sub = _attacker_mate_in(rb, side, moves_left - 1)
            if sub is None:
                ok = False
                break
            # 取「最长抵抗」的应着作为主变代表
            if worst_reply_line is None or len(sub) > len(worst_reply_line[1]):
                worst_reply_line = [(rr, rc, rtr, rtc), sub]
        if ok and worst_reply_line is not None:
            cand = line_for_this + [worst_reply_line[0]] + worst_reply_line[1]
            if best is None or len(cand) < len(best):
                best = cand
    return best


def solve_mate(fen: str, max_moves: int = 4) -> list[str] | None:
    """搜索强制将杀，返回 UCI 着法序列（己方/对方交替），无解返回 None。

    max_moves 为己方着法数上限（mate-in-N 的 N）。逐层加深，取最短解。
    """
    parts = fen.split()
    side = parts[1] if len(parts) > 1 else "w"
    board = parse_fen(fen)
    if in_check(board, side):  # 己方正被将军，不是「找杀」局面
        return None
    for depth in range(1, max_moves + 1):
        line = _attacker_mate_in(board, side, depth)
        if line is not None:
            return [_uci(*m) for m in line]
    return None


# ── 杀法自动分类 ───────────────────────────────────────────────────

def _rc(uci: str) -> tuple[int, int, int, int]:
    fc, fr, tc, tr = uci[0], int(uci[1]), uci[2], int(uci[3])
    return 9 - fr, FILES.index(fc), 9 - tr, FILES.index(tc)


def _find(board, target: str):
    for r in range(10):
        for c in range(9):
            if board[r][c] == target:
                return r, c
    return None


def classify(fen: str, solution: list[str]) -> str:
    """依据将死局面与最后一手，启发式识别杀法名目。无法判定时归「综合杀法」。"""
    parts = fen.split()
    side = parts[1] if len(parts) > 1 else "w"
    board = parse_fen(fen)
    # 走完整条主变，得到将死局面与最后一手
    last = solution[-1]
    for mv in solution:
        fr, fc, tr, tc = _rc(mv)
        board = _apply(board, fr, fc, tr, tc)
    opp = _opp(side)
    king = _find(board, "k" if opp == "b" else "K")
    if king is None:
        return "综合杀法"
    kr, kc = king
    lfr, lfc, ltr, ltc = _rc(last)
    mover = board[ltr][ltc]
    kind = mover.upper() if mover else ""

    # 对面笑（白脸将）：两将同列、中间无子，由帅/将照面致杀
    own_king = _find(board, "K" if side == "w" else "k")
    if own_king and own_king[1] == kc and all(
        board[r][kc] is None for r in range(min(own_king[0], kr) + 1, max(own_king[0], kr))
    ):
        return "对面笑"

    if kind == "N":
        # 卧槽马：马落在对方将的「斜下/斜上贴身」九宫口位置（将旁一格的马步将军）
        if abs(ltr - kr) + abs(ltc - kc) == 3 and abs(ltr - kr) <= 2 and abs(ltc - kc) <= 2:
            # 卧槽马典型落点：将的同侧底线旁；以「贴近将」近似判定
            if min(abs(ltr - kr), abs(ltc - kc)) == 1:
                return "卧槽马"
        return "马后炮" if _has_cannon_behind(board, side, kr, kc) else "马杀"

    if kind == "C":
        # 马后炮：炮将军且炮与将之间隔一子（常为马），后方支撑
        if ltc == kc or ltr == kr:
            return "重炮" if _double_cannon(board, side, kr, kc) else "炮杀"
        return "炮杀"

    if kind == "R":
        return "双车错" if _count(board, "R" if side == "w" else "r") >= 2 else "车杀"

    if kind == "P":
        return "兵杀"

    return "综合杀法"


def _has_cannon_behind(board, side, kr, kc) -> bool:
    cannon = "C" if side == "w" else "c"
    for r in range(10):
        if board[r][kc] == cannon:
            return True
    return False


def _double_cannon(board, side, kr, kc) -> bool:
    cannon = "C" if side == "w" else "c"
    return sum(1 for r in range(10) if board[r][kc] == cannon) >= 2


def _count(board, piece) -> int:
    return sum(1 for row in board for p in row if p == piece)
