"""象棋 FEN 工具：解析 / 应用着法 / 生成新 FEN。

UCI 坐标：file=a..i（列 0-8），rank=0..9（红方在下，rank9=顶部）。
棋盘内部：board[row][col]，row=0 对应 rank9（顶部黑方底线）。
"""

FILES = "abcdefghi"


def _parse_placement(placement: str) -> list[list[str | None]]:
    board: list[list[str | None]] = []
    for row_str in placement.split("/"):
        row: list[str | None] = []
        for ch in row_str:
            if ch.isdigit():
                row.extend([None] * int(ch))
            else:
                row.append(ch)
        while len(row) < 9:
            row.append(None)
        board.append(row)
    return board  # board[0] = rank9 (top)


def _gen_placement(board: list[list[str | None]]) -> str:
    parts = []
    for row in board:
        empty = 0
        seg = ""
        for cell in row:
            if cell is None:
                empty += 1
            else:
                if empty:
                    seg += str(empty)
                    empty = 0
                seg += cell
        if empty:
            seg += str(empty)
        parts.append(seg)
    return "/".join(parts)


def apply_move(fen: str, uci_move: str) -> str:
    """将 UCI 着法应用到 FEN 局面，返回新 FEN（不做合法性校验）。"""
    parts = fen.split()
    placement = parts[0]
    side = parts[1] if len(parts) > 1 else "w"
    rest = parts[2:] if len(parts) > 2 else ["-", "-", "0", "1"]

    board = _parse_placement(placement)

    fc, fr_s, tc, tr_s = uci_move[0], uci_move[1], uci_move[2], uci_move[3]
    fr, tr = int(fr_s), int(tr_s)
    from_row, from_col = 9 - fr, FILES.index(fc)
    to_row, to_col = 9 - tr, FILES.index(tc)

    piece = board[from_row][from_col]
    board[from_row][from_col] = None
    board[to_row][to_col] = piece

    new_side = "b" if side == "w" else "w"
    return " ".join([_gen_placement(board), new_side] + rest)
