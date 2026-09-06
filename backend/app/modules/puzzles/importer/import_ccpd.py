"""把 CCPD（Chinese Chess Practical Dataset）的 PGN 转为训练题 JSON。

CCPD 使用 Big5 编码、中国象棋中文记谱，并按「開局／中局／殘局」分目录。
转换器不依赖第三方棋谱库：逐步枚举当前局面的合法着法，再用项目已有的
中文记谱器反向匹配，从而同时完成中文记谱转 UCI 和逐手合法性校验。

数据源（CC BY 4.0）：
https://github.com/Yvonne761/Chinese-Chess-Practical-Dataset

用法（在 backend/ 目录）：
    python -m app.modules.puzzles.importer.import_ccpd ../CCPD/Dataset --engine <Pikafish路径>
    python -m app.modules.puzzles.importer.load seeds/ccpd_curriculum.json

注意导入时不要加 --verify：那会拒收引擎不认可但来自大师实战主线的题，
引擎核对应在转换阶段（--engine）完成并写入 verified 标记。
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from app.shared.xiangqi import FILES, apply_move, uci_to_chinese
from app.shared.xiangqi.validation import legal_moves, parse_fen


KINDS = {"開局": "开局", "开局": "开局", "中局": "中局", "殘局": "残局", "残局": "残局"}
DEFAULT_LIMITS = {"开局": 300, "中局": 500, "残局": 200}
_HEADER_RE = re.compile(r'^\[([^ ]+)\s+"(.*)"\]$')
_MOVE_NO_RE = re.compile(r"\d+\.(?:\.\.)?")
_RESULTS = {"1-0", "0-1", "1/2-1/2", "*"}
_TRADITIONAL = str.maketrans({"車": "车", "馬": "马", "砲": "炮", "進": "进", "後": "后"})


@dataclass
class ParsedGame:
    headers: dict[str, str]
    moves: list[str]


def _read_pgn(path: Path) -> ParsedGame:
    raw = path.read_bytes()
    text = None
    for encoding in ("big5", "utf-8-sig", "gb18030"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("无法识别棋谱编码")

    headers: dict[str, str] = {}
    body: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        match = _HEADER_RE.match(line)
        if match:
            headers[match.group(1)] = match.group(2)
        elif line:
            body.append(line)

    move_text = _MOVE_NO_RE.sub(" ", " ".join(body))
    tokens = [token for token in move_text.split() if token not in _RESULTS]
    return ParsedGame(headers, tokens)


def _normalise_notation(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).translate(_TRADITIONAL)
    return value.replace("傌", "马").replace("帥", "帅").replace("將", "将")


def _uci(row: int, col: int, target_row: int, target_col: int) -> str:
    return f"{FILES[col]}{9 - row}{FILES[target_col]}{9 - target_row}"


def notation_to_uci(fen: str, notation: str) -> str:
    """在给定局面中把一着中文记谱唯一地转换为 UCI。"""
    expected = _normalise_notation(notation)
    side = fen.split()[1]
    candidates = []
    for move in legal_moves(parse_fen(fen), side):
        uci = _uci(*move)
        if _normalise_notation(uci_to_chinese(fen, uci)) == expected:
            candidates.append(uci)
    if len(candidates) != 1:
        raise ValueError(f"中文着法无法唯一匹配：{notation}（候选 {candidates}）")
    return candidates[0]


def _opening_category(event: str) -> str:
    for name in ("中炮", "仙人指路", "飞相局", "起马局", "过宫炮", "仕角炮"):
        if name in _normalise_notation(event):
            return name
    return "开局定式"


def _endgame_category(fen: str) -> str:
    pieces = fen.split()[0].lower()
    if "r" in pieces:
        return "车类残局"
    if "c" in pieces and "n" in pieces:
        return "马炮残局"
    if "c" in pieces:
        return "炮类残局"
    if "n" in pieces:
        return "马类残局"
    return "兵卒残局"


def _category(kind: str, headers: dict[str, str]) -> str:
    if kind == "开局":
        return _opening_category(headers.get("Event", ""))
    if kind == "残局":
        return _endgame_category(headers["FEN"])
    return "候选着"


def _difficulty(kind: str, fen: str) -> int:
    if kind == "开局":
        return 2
    if kind == "中局":
        return 3
    material = sum(ch.isalpha() for ch in fen.split()[0])
    return 5 if material <= 8 else 4 if material <= 14 else 3


def convert_file(path: Path, kind: str, max_plies: int = 3, start_ply: int = 0) -> dict:
    game = _read_pgn(path)
    fen = game.headers.get("FEN", "").strip()
    if len(fen.split("/")) != 10 or len(fen.split()) < 2:
        raise ValueError("缺少有效 FEN")
    if not game.moves:
        raise ValueError("棋谱没有着法")

    current = fen
    converted: list[str] = []
    needed = min(len(game.moves), start_ply + max_plies)
    for notation in game.moves[:needed]:
        move = notation_to_uci(current, notation)
        converted.append(move)
        current = apply_move(current, move)
    start_ply = min(start_ply, max(0, len(converted) - max_plies))
    puzzle_fen = fen
    for move in converted[:start_ply]:
        puzzle_fen = apply_move(puzzle_fen, move)
    solution = converted[start_ply:start_ply + max_plies]
    if len(solution) < min(2, max_plies):
        raise ValueError("主线过短")

    event = _normalise_notation(game.headers.get("Event", "")).strip()
    tags = ["CCPD实战谱"]
    if game.headers.get("ECCO"):
        tags.append(f"ECCO {game.headers['ECCO']}")
    if event:
        tags.append(event[:40])
    return {
        "fen": puzzle_fen,
        "solution": solution,
        "side_to_move": puzzle_fen.split()[1],
        "kind": kind,
        "category": _category(kind, game.headers),
        "difficulty": _difficulty(kind, puzzle_fen),
        "steps": (len(solution) + 1) // 2,
        "source": f"CCPD:{kind}:{path.stem}",
        "verified": False,
        "tags": ",".join(tags),
    }


def _evenly_spaced(items: list[Path], limit: int) -> list[Path]:
    if limit <= 0 or len(items) <= limit:
        return items
    return [items[index * len(items) // limit] for index in range(limit)]


def convert_dataset(
    dataset: Path,
    limits: dict[str, int] | None = None,
    max_plies: int = 3,
    engine=None,
    movetime_ms: int = 100,
) -> tuple[list[dict], dict]:
    limits = limits or DEFAULT_LIMITS
    output: list[dict] = []
    report = {"added": {}, "failed": {}, "verified": {}, "duplicates": 0}
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for directory_name, kind in KINDS.items():
        directory = dataset / directory_name
        if not directory.is_dir():
            continue
        added = failed = verified = 0
        # 多取一些候选，解析失败时仍尽量达到目标数量。
        files = sorted(directory.glob("*.pgn"))
        candidates = _evenly_spaced(files, min(len(files), max(limits[kind] * 2, limits[kind])))
        for path in candidates:
            if added >= limits[kind]:
                break
            try:
                # 开局谱的前几手高度重复；沿定式线错开起点，才能形成有区分度的训练题。
                start_ply = 0
                if kind == "开局":
                    serial = int(path.stem) if path.stem.isdigit() else sum(path.stem.encode())
                    start_ply = 4 + serial % 12
                item = convert_file(path, kind, max_plies=max_plies, start_ply=start_ply)
            except (OSError, UnicodeError, ValueError, IndexError):
                failed += 1
                continue
            key = (item["fen"], tuple(item["solution"]))
            if key in seen:
                report["duplicates"] += 1
                continue
            if engine is not None and engine.bestmove(item["fen"], movetime_ms) == item["solution"][0]:
                item["verified"] = True
                verified += 1
            seen.add(key)
            output.append(item)
            added += 1
        report["added"][kind] = added
        report["failed"][kind] = failed
        report["verified"][kind] = verified
    return output, report


def main() -> None:
    parser = argparse.ArgumentParser(description="把 CCPD 开局／中局／残局转换为项目题库")
    parser.add_argument("dataset", type=Path, help="CCPD 的 Dataset 目录")
    parser.add_argument("--out", type=Path, default=Path("seeds/ccpd_curriculum.json"))
    parser.add_argument("--opening", type=int, default=DEFAULT_LIMITS["开局"])
    parser.add_argument("--middlegame", type=int, default=DEFAULT_LIMITS["中局"])
    parser.add_argument("--endgame", type=int, default=DEFAULT_LIMITS["残局"])
    parser.add_argument("--plies", type=int, default=3, choices=range(1, 8), help="每题保留的主线半回合数")
    parser.add_argument("--engine", type=str, default="", help="可选：Pikafish 等 UCI 引擎路径")
    parser.add_argument("--movetime", type=int, default=100, help="每题引擎核对毫秒数")
    args = parser.parse_args()
    limits = {"开局": args.opening, "中局": args.middlegame, "残局": args.endgame}
    engine = None
    if args.engine:
        from .uci import UciEngine

        engine = UciEngine(args.engine)
    try:
        items, report = convert_dataset(args.dataset, limits, args.plies, engine, args.movetime)
    finally:
        if engine is not None:
            engine.close()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"完成：{report}，共输出 {len(items)} 题 → {args.out}")


if __name__ == "__main__":
    main()
