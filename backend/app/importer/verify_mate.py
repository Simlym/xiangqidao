"""中国象棋规则与「一步杀」校验。

实现着法生成、将军 / 将死判定，用于校验题库里的杀法题是否成立——
比依赖外部引擎更可靠，也不需要安装 Pikafish。

坐标约定与全工程一致：
- UCI：file=a..i（列 0-8），rank=0..9（红方在下，rank9=顶部）。
- 内部 board[row][col]，row=0 对应 rank9（顶部，黑方底线）。
"""

from __future__ import annotations

FILES = "abcdefghi"
ROWS, COLS = 10, 9


def parse_fen(fen: str) -> list[list[str | None]]:
    placement = fen.split()[0]
    board: list[list[str | None]] = []
    for row_str in placement.split("/"):
        row: list[str | None] = []
        for ch in row_str:
            if ch.isdigit():
                row.extend([None] * int(ch))
            else:
                row.append(ch)
        while len(row) < COLS:
            row.append(None)
        board.append(row)
    return board


def is_red(piece: str) -> bool:
    return piece.isupper()


def side_of(piece: str) -> str:
    return "w" if piece.isupper() else "b"


def in_palace(row: int, col: int, side: str) -> bool:
    if col < 3 or col > 5:
        return False
    return (7 <= row <= 9) if side == "w" else (0 <= row <= 2)


def find_general(board, side: str) -> tuple[int, int] | None:
    target = "K" if side == "w" else "k"
    for r in range(ROWS):
        for c in range(COLS):
            if board[r][c] == target:
                return r, c
    return None


def _on(r: int, c: int) -> bool:
    return 0 <= r < ROWS and 0 <= c < COLS


def piece_targets(board, r: int, c: int) -> list[tuple[int, int]]:
    """某子能走到（含吃子）的所有目标点（伪合法，不含将军自检）。"""
    piece = board[r][c]
    if piece is None:
        return []
    side = side_of(piece)
    red = side == "w"
    kind = piece.upper()
    out: list[tuple[int, int]] = []

    def empty(rr, cc):
        return _on(rr, cc) and board[rr][cc] is None

    def enemy_or_empty(rr, cc):
        return _on(rr, cc) and (board[rr][cc] is None or side_of(board[rr][cc]) != side)

    if kind == "K":
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if in_palace(nr, nc, side) and enemy_or_empty(nr, nc):
                out.append((nr, nc))
    elif kind == "A":
        for dr, dc in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            nr, nc = r + dr, c + dc
            if in_palace(nr, nc, side) and enemy_or_empty(nr, nc):
                out.append((nr, nc))
    elif kind == "B":
        for dr, dc in ((2, 2), (2, -2), (-2, 2), (-2, -2)):
            nr, nc = r + dr, c + dc
            er, ec = r + dr // 2, c + dc // 2  # 象眼
            if not _on(nr, nc) or not empty(er, ec):
                continue
            # 不可过河
            if red and nr < 5:
                continue
            if not red and nr > 4:
                continue
            if enemy_or_empty(nr, nc):
                out.append((nr, nc))
    elif kind == "N":
        for dr, dc, br, bc in (
            (2, 1, 1, 0), (2, -1, 1, 0), (-2, 1, -1, 0), (-2, -1, -1, 0),
            (1, 2, 0, 1), (-1, 2, 0, 1), (1, -2, 0, -1), (-1, -2, 0, -1),
        ):
            nr, nc = r + dr, c + dc
            if not _on(nr, nc) or not empty(r + br, c + bc):  # 蹩马腿
                continue
            if enemy_or_empty(nr, nc):
                out.append((nr, nc))
    elif kind == "R":
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            while _on(nr, nc):
                if board[nr][nc] is None:
                    out.append((nr, nc))
                else:
                    if side_of(board[nr][nc]) != side:
                        out.append((nr, nc))
                    break
                nr += dr
                nc += dc
    elif kind == "C":
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            jumped = False
            while _on(nr, nc):
                cell = board[nr][nc]
                if not jumped:
                    if cell is None:
                        out.append((nr, nc))
                    else:
                        jumped = True
                else:
                    if cell is not None:
                        if side_of(cell) != side:
                            out.append((nr, nc))  # 隔子吃
                        break
                nr += dr
                nc += dc
    elif kind == "P":
        forward = -1 if red else 1  # 红向上（row 减小）
        nr = r + forward
        if enemy_or_empty(nr, c):
            out.append((nr, c))
        crossed = (r <= 4) if red else (r >= 5)  # 过河后可横走
        if crossed:
            for dc in (1, -1):
                if enemy_or_empty(r, c + dc):
                    out.append((r, c + dc))
    return out


def generals_facing(board) -> bool:
    """白脸将：两将同列且中间无子。"""
    wk = find_general(board, "w")
    bk = find_general(board, "b")
    if not wk or not bk or wk[1] != bk[1]:
        return False
    col = wk[1]
    lo, hi = sorted((wk[0], bk[0]))
    return all(board[r][col] is None for r in range(lo + 1, hi))


def in_check(board, side: str) -> bool:
    """side 的将是否被将军（含白脸将）。"""
    gen = find_general(board, side)
    if gen is None:
        return True
    if generals_facing(board):
        return True
    for r in range(ROWS):
        for c in range(COLS):
            p = board[r][c]
            if p is None or side_of(p) == side:
                continue
            if gen in piece_targets(board, r, c):
                return True
    return False


def _apply(board, fr, fc, tr, tc):
    nb = [row[:] for row in board]
    nb[tr][tc] = nb[fr][fc]
    nb[fr][fc] = None
    return nb


def legal_moves(board, side: str) -> list[tuple[int, int, int, int]]:
    moves = []
    for r in range(ROWS):
        for c in range(COLS):
            p = board[r][c]
            if p is None or side_of(p) != side:
                continue
            for tr, tc in piece_targets(board, r, c):
                nb = _apply(board, r, c, tr, tc)
                if not in_check(nb, side):
                    moves.append((r, c, tr, tc))
    return moves


def is_checkmate(board, side: str) -> bool:
    """side 是否被将死：正被将军且无合法着法。"""
    return in_check(board, side) and not legal_moves(board, side)


def uci_to_rc(move: str) -> tuple[int, int, int, int]:
    fc, fr, tc, tr = move[0], int(move[1]), move[2], int(move[3])
    return 9 - fr, FILES.index(fc), 9 - tr, FILES.index(tc)


def is_mate_in_one(fen: str, move: str) -> tuple[bool, str]:
    """校验：side_to_move 走 move 后，对方被将死。返回 (是否成立, 原因)。"""
    parts = fen.split()
    side = parts[1] if len(parts) > 1 else "w"
    board = parse_fen(fen)
    fr, fc, tr, tc = uci_to_rc(move)
    p = board[fr][fc]
    if p is None:
        return False, "起点无子"
    if side_of(p) != side:
        return False, "走子方与 side_to_move 不符"
    if (tr, tc) not in piece_targets(board, fr, fc):
        return False, "该着法不合规则"
    nb = _apply(board, fr, fc, tr, tc)
    if in_check(nb, side):
        return False, "走后自将（送将）"
    opp = "b" if side == "w" else "w"
    if not in_check(nb, opp):
        return False, "未将军"
    if not is_checkmate(nb, opp):
        return False, "将军但未将死"
    return True, "一步杀成立"
