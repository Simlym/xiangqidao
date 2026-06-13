"""象棋 FEN 工具：解析 / 应用着法 / 生成新 FEN。

UCI 坐标：file=a..i（列 0-8），rank=0..9（红方在下，rank9=顶部）。
棋盘内部：board[row][col]，row=0 对应 rank9（顶部黑方底线）。
"""

FILES = "abcdefghi"

# 棋子字符 -> 中文名（大写=红方，小写=黑方）
GLYPH = {
    "K": "帅", "A": "仕", "B": "相", "N": "马", "R": "车", "C": "炮", "P": "兵",
    "k": "将", "a": "士", "b": "象", "n": "马", "r": "车", "c": "炮", "p": "卒",
}

# 红方列号/步数用中文一~九；黑方用阿拉伯 1~9
_RED_NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"]


def _num_str(n: int, red: bool) -> str:
    return _RED_NUMS[n - 1] if red else str(n)


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


def render_board(fen: str) -> str:
    """把 FEN 渲染成带坐标的中文棋盘图，便于大模型「看懂」局面。

    顶部为黑方（rank9→rank0 从上到下），列标 a-i。红子用【】包裹、黑子用（）包裹，
    空点用「·」。这样模型无需自行解析 FEN 字符串即可推理子力关系。
    """
    board = _parse_placement(fen.split()[0])  # board[0]=rank9（顶部）
    lines = ["   a  b  c  d  e  f  g  h  i"]
    for r, row in enumerate(board):
        rank = 9 - r
        cells = []
        for cell in row:
            if cell is None:
                cells.append(" · ")
            elif cell.isupper():           # 红方
                cells.append(f"[{GLYPH.get(cell, cell)}]")
            else:                          # 黑方
                cells.append(f"({GLYPH.get(cell, cell)})")
        lines.append(f"{rank}  " + "".join(cells))
        if rank == 5:                      # 楚河汉界
            lines.append("   ——— 楚河 · 汉界 ———")
    lines.append("（上方为黑方，下方为红方；[]内为红子，()内为黑子）")
    return "\n".join(lines)


def uci_to_chinese(fen: str, uci: str) -> str:
    """把 UCI 着法转成中文棋谱（如「炮二平五」「马8进7」）。

    fen 须为该步走子之前的局面，用于确定棋子种类、红黑及同列同子的前后关系。
    无法解析时回退返回原始 UCI。与前端 xiangqi.js:uciToChinese 保持一致。
    """
    if not fen or not uci or len(uci) < 4:
        return uci

    # board[rank][col]，rank 0..9（红方在下），col 0..8（a..i）
    placement = _parse_placement(fen.split()[0])  # placement[0]=rank9（顶部）
    board = [[None] * 9 for _ in range(10)]
    for r, row in enumerate(placement):
        rank = 9 - r
        for col in range(9):
            board[rank][col] = row[col]

    from_col = FILES.index(uci[0]) if uci[0] in FILES else -1
    to_col = FILES.index(uci[2]) if uci[2] in FILES else -1
    if from_col < 0 or to_col < 0 or not uci[1].isdigit() or not uci[3].isdigit():
        return uci
    from_rank, to_rank = int(uci[1]), int(uci[3])

    piece = board[from_rank][from_col]
    if not piece:
        return uci
    red = piece.isupper()
    name = GLYPH.get(piece, piece)

    # 列号：红方从右到左数（col8→一），黑方从左到右数（col0→1）
    def file_num(col: int) -> int:
        return 9 - col if red else col + 1

    # 同列同种棋子用「前/后」标识，否则用列号
    same_col = [rk for rk in range(10) if board[rk][from_col] == piece]
    if len(same_col) >= 2:
        # 越靠近对方越「前」：红方 rank 大者在前，黑方 rank 小者在前
        same_col.sort(key=lambda rk: -rk if red else rk)
        pos = same_col.index(from_rank)
        if len(same_col) == 2:
            pos_word = "前" if pos == 0 else "后"
        elif len(same_col) == 3:
            pos_word = ["前", "中", "后"][pos]
        else:
            pos_word = _num_str(pos + 1, red)
        head = pos_word + name
    else:
        head = name + _num_str(file_num(from_col), red)

    if from_rank == to_rank:
        action = "平"
        target = _num_str(file_num(to_col), red)
    else:
        forward = (to_rank > from_rank) if red else (to_rank < from_rank)
        action = "进" if forward else "退"
        # 车炮兵帅走直线，进退用「步数」；马相仕走斜/拐，进退用「目标列号」
        straight = piece.upper() in "RCPK"
        target = (
            _num_str(abs(to_rank - from_rank), red) if straight
            else _num_str(file_num(to_col), red)
        )

    return head + action + target
