"""题解分支、规则型讲解与内容标签的公共逻辑。"""

from __future__ import annotations

from .importer.verify_mate import FILES, parse_fen
from .play_engine import game_status
from .xiangqi_utils import apply_move


PIECE_NAMES = {
    "K": "帅", "A": "仕", "B": "相", "N": "马", "R": "车", "C": "炮", "P": "兵",
    "k": "将", "a": "士", "b": "象", "n": "马", "r": "车", "c": "炮", "p": "卒",
}


def solution_lines(raw: str) -> list[list[str]]:
    """解析多变着：不同分支用 | 分隔，分支内部仍用逗号分隔。"""
    lines = []
    for branch in (raw or "").split("|"):
        moves = [m.strip() for m in branch.split(",") if m.strip()]
        if moves:
            lines.append(moves)
    return lines


def primary_line(raw: str) -> list[str]:
    lines = solution_lines(raw)
    return lines[0] if lines else []


def rule_explanation(puzzle) -> str:
    """无需大模型的确定性棋理解说；只在结算后返回，不提前泄题。"""
    moves = primary_line(puzzle.solution)
    if not moves:
        return "先比较候选着的将军、吃子和威胁，再检查对手最强应手。"
    fen = puzzle.fen
    ideas: list[str] = []
    for idx, move in enumerate(moves):
        try:
            board = parse_fen(fen)
            col = FILES.index(move[0])
            row = 9 - int(move[1])
            piece = PIECE_NAMES.get(board[row][col], "棋子")
            target_col = FILES.index(move[2])
            target_row = 9 - int(move[3])
            capture = bool(board[target_row][target_col])
            after = apply_move(fen, move)
            status = game_status(after)
            actor = "关键着" if idx % 2 == 0 else "对手最强应手"
            effect = "完成将死" if status == "checkmate" else "吃子并改变子力关系" if capture else "制造连续威胁"
            ideas.append(f"{actor}用{piece}走 {move}：{effect}")
            fen = after
        except Exception:
            break
    principle = {
        "开局": "开局优先比较出子效率、中心控制与王的安全，避免同一子反复移动。",
        "中局": "中局按“将军—吃子—威胁”排序候选着，并核对对手最强反击。",
        "残局": "残局先算兵卒速度与将帅位置，再决定兑子还是保留进攻子力。",
        "杀法": "连续将军不是目的；每一步都要压缩将的合法逃路并保持后续衔接。",
    }.get(getattr(puzzle, "kind", "杀法") or "杀法", "先识别局面目标，再比较对手的最强应手。")
    return principle + ("\n" + "；".join(ideas) if ideas else "")
