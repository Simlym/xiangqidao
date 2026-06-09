"""题库导入。

从 JSON 文件批量导入战术题，可选用 Pikafish 校验正解第一手是否为引擎最优着。

运行（在 backend/ 目录下）:
    python -m app.importer.load app/importer/seed_puzzles.json
    python -m app.importer.load app/importer/seed_puzzles.json --verify
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select

from ..models import Puzzle, SessionLocal, init_db


def load(path: str, verify: bool = False, movetime_ms: int = 1000, mate_check: bool = False) -> None:
    init_db()
    data = json.loads(Path(path).read_text(encoding="utf-8"))

    engine = None
    if verify:
        from .pikafish import Pikafish

        engine = Pikafish()
        print("Pikafish 已启动，将逐题校验正解…")
    if mate_check:
        from .verify_mate import is_mate_in_one

        print("将用内置规则校验每题是否为成立的一步杀…")

    added, skipped, bad = 0, 0, 0
    with SessionLocal() as db:
        for item in data:
            fen = item["fen"]
            solution = item["solution"]  # list[str] 或逗号串
            if isinstance(solution, list):
                solution = ",".join(solution)
            first_move = solution.split(",")[0].strip()

            # 去重：相同 fen+solution 视为同题
            exists = db.scalar(
                select(Puzzle).where(Puzzle.fen == fen, Puzzle.solution == solution)
            )
            if exists:
                skipped += 1
                continue

            # 内置一步杀校验（仅适用于单步杀法题）
            if mate_check and len(solution.split(",")) == 1:
                full = fen if len(fen.split()) > 1 else fen + " " + item.get("side_to_move", "w")
                ok, why = is_mate_in_one(full, first_move)
                if not ok:
                    print(f"  ✗ 非一步杀 fen={fen}  题解={first_move}  原因={why}")
                    bad += 1
                    continue

            verified = False
            if engine:
                best = engine.bestmove(fen, movetime_ms)
                if best != first_move:
                    print(f"  ✗ 校验不符 fen={fen}  题解={first_move}  引擎={best}")
                    bad += 1
                    continue
                verified = True

            # steps 缺省按题解己方着法数推断（总手数向上取整的一半）
            n_moves = len(solution.split(","))
            db.add(
                Puzzle(
                    fen=fen,
                    solution=solution,
                    side_to_move=item.get("side_to_move", "w"),
                    kind=item.get("kind", "杀法"),
                    category=item.get("category", "未分类"),
                    difficulty=int(item.get("difficulty", 3)),
                    steps=int(item.get("steps", (n_moves + 1) // 2)),
                    source=item.get("source", ""),
                    verified=verified,
                )
            )
            added += 1
        db.commit()

    if engine:
        engine.close()
    print(f"完成：新增 {added}，跳过(重复) {skipped}，校验失败 {bad}")


def main() -> None:
    ap = argparse.ArgumentParser(description="导入战术题库")
    ap.add_argument("path", help="题库 JSON 文件路径")
    ap.add_argument("--verify", action="store_true", help="用 Pikafish 校验正解")
    ap.add_argument("--mate-check", action="store_true", help="用内置规则校验单步杀法题（无需 Pikafish）")
    ap.add_argument("--movetime", type=int, default=1000, help="每题引擎思考毫秒数")
    args = ap.parse_args()
    load(args.path, verify=args.verify, movetime_ms=args.movetime, mate_check=args.mate_check)


if __name__ == "__main__":
    sys.exit(main())
