"""测试 apply_move：应用 UCI 着法后 FEN 变化正确。

FEN: "4k4/R8/8R/9/9/9/9/9/9/3K5 w - - 0 1"
  row0 (rank9): 4k4   → col4=k
  row1 (rank8): R8    → col0=R  → square "a8"
  row2 (rank7): 8R    → col8=R  → square "i7"
"""

from app.xiangqi_utils import _parse_placement, apply_move

FEN = "4k4/R8/8R/9/9/9/9/9/9/3K5 w - - 0 1"


def test_move_changes_piece_position():
    # 红车 i7 走到 i9（col8, row2 → col8, row0）
    new_fen = apply_move(FEN, "i7i9")
    board = _parse_placement(new_fen.split()[0])
    assert board[0][8] == "R", f"期望 row0 col8=R，得 {board[0][8]}"
    assert board[2][8] is None, "原位置 i7 应清空"


def test_capture_removes_target():
    # 红车 a8 走到 a9（col0, row1 → col0, row0；a9 无棋子，普通移动）
    new_fen = apply_move(FEN, "a8a9")
    board = _parse_placement(new_fen.split()[0])
    assert board[0][0] == "R", f"期望 row0 col0=R，得 {board[0][0]}"
    assert board[1][0] is None, "原位置 a8 应清空"


def test_side_toggles_w_to_b():
    new_fen = apply_move(FEN, "a8a9")
    assert new_fen.split()[1] == "b"


def test_side_toggles_b_to_w():
    fen_b = FEN.replace(" w ", " b ", 1)
    new_fen = apply_move(fen_b, "a8a9")
    assert new_fen.split()[1] == "w"


def test_roundtrip_placement():
    """apply_move 后 FEN 可再次解析成 10×9 棋盘。"""
    new_fen = apply_move(FEN, "i7i9")
    board = _parse_placement(new_fen.split()[0])
    assert len(board) == 10
    assert all(len(r) == 9 for r in board)
