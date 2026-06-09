"""从 wukong-xiangqi 开源题库接入实战杀局。

数据源（MIT 开源）：maksimKorzh/wukong-xiangqi，约 3386 道取自世界象棋锦标赛等
实战对局的杀局，每题仅含局面（FEN）与「Mate in N moves」标注，**没有题解着法**。
本脚本用内置规则引擎（solver.solve_mate）离线求出强制连将杀的正解，并自动分类、
按步数定难度，产出本系统可直接导入的 JSON。

「先弃后杀 / 安静着造杀」类（非连续将军）无法被纯将军搜索求解，将被跳过——
保证导出的每一题都是经规则引擎验证成立的连将杀，正解可靠。

用法（在 backend/ 目录）:
    # 下载并求解，产出 JSON（可加 --limit 先小批量试跑）
    python -m app.importer.import_wukong --out app/importer/wukong_puzzles.json
    # 再导入数据库
    python -m app.importer.load app/importer/wukong_puzzles.json
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from pathlib import Path

from .solver import classify, solve_mate

SOURCE_URL = (
    "https://raw.githubusercontent.com/maksimKorzh/wukong-xiangqi/"
    "main/apps/puzzle_solver/gui/game/puzzles.js"
)

# title「Mate in N moves」→ 搜索深度；"?" 用较大上限尝试
_TITLE_RE = re.compile(r"Mate in (\d+|\?)")


def _load_source(src: str) -> list[dict]:
    """从 URL 或本地文件读取 puzzles.js，解析出原始题目数组。"""
    if src.startswith("http"):
        with urllib.request.urlopen(src, timeout=60) as resp:
            text = resp.read().decode("utf-8")
    else:
        text = Path(src).read_text(encoding="utf-8")
    body = text[text.index("[") : text.rindex("]") + 1]
    return json.loads(body)


def _depth_for(title: str) -> int:
    m = _TITLE_RE.search(title or "")
    if not m:
        return 4
    return 5 if m.group(1) == "?" else min(int(m.group(1)), 6)


def convert(raw: list[dict], limit: int | None = None) -> tuple[list[dict], dict]:
    out: list[dict] = []
    stats = {"total": 0, "solved": 0, "skipped": 0}
    for p in raw:
        if limit and stats["solved"] >= limit:
            break
        stats["total"] += 1
        fen = p["fen"]
        solution = solve_mate(fen, max_moves=_depth_for(p.get("title", "")))
        if not solution:
            stats["skipped"] += 1
            continue
        steps = (len(solution) + 1) // 2
        out.append(
            {
                "fen": fen,
                "solution": solution,
                "side_to_move": fen.split()[1] if len(fen.split()) > 1 else "w",
                "kind": "杀法",
                "category": classify(fen, solution),
                "difficulty": min(5, steps),
                "steps": steps,
                "source": "wukong",
            }
        )
        stats["solved"] += 1
    return out, stats


def main() -> None:
    ap = argparse.ArgumentParser(description="接入 wukong-xiangqi 实战杀局题库")
    ap.add_argument("--src", default=SOURCE_URL, help="puzzles.js 的 URL 或本地路径")
    ap.add_argument("--out", default="app/importer/wukong_puzzles.json")
    ap.add_argument("--limit", type=int, default=None, help="只取前 N 道成功求解的题（试跑用）")
    args = ap.parse_args()

    print(f"读取题源：{args.src}")
    raw = _load_source(args.src)
    print(f"原始题数：{len(raw)}，开始求解…")
    t0 = time.time()
    puzzles, stats = convert(raw, limit=args.limit)
    Path(args.out).write_text(
        json.dumps(puzzles, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    cats: dict[str, int] = {}
    for p in puzzles:
        cats[p["category"]] = cats.get(p["category"], 0) + 1
    print(
        f"完成：求解 {stats['solved']}/{stats['total']}，"
        f"跳过(非连将杀) {stats['skipped']}，用时 {time.time() - t0:.0f}s"
    )
    print("分类分布：" + "，".join(f"{k}×{v}" for k, v in sorted(cats.items(), key=lambda x: -x[1])))
    print(f"已写出 → {args.out}")


if __name__ == "__main__":
    main()
