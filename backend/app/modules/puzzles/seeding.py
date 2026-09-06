"""首次启动自动播种公共题库。

种子数据与代码分离，存放在 backend/seeds/（Docker 镜像内为 /app/seeds），
目录可用环境变量 SEEDS_DIR 覆盖。应用启动时若公共题库为空，则自动导入
该目录下全部 JSON；已有题库则直接跳过，扩容或更新仍用 importer.load。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from app.core.models import SessionLocal
from app.modules.puzzles.importer.load import import_items
from app.modules.puzzles.repository import PUBLIC_OWNER, count_puzzles


def seeds_dir() -> Path:
    """种子目录：优先取 SEEDS_DIR，缺省为代码仓库的 backend/seeds。"""
    override = os.environ.get("SEEDS_DIR", "").strip()
    if override:
        return Path(override)
    # app/modules/puzzles/seeding.py → backend/seeds（容器内 /app/seeds）
    return Path(__file__).resolve().parents[3] / "seeds"


def seed_default_library() -> None:
    """公共题库为空时从种子目录导入；非空或目录缺失则跳过，幂等可重入。"""
    directory = seeds_dir()
    if not directory.is_dir():
        print(f"种子目录不存在，跳过题库播种：{directory}")
        return

    files = sorted(directory.glob("*.json"))
    if not files:
        return

    with SessionLocal() as db:
        if count_puzzles(db, PUBLIC_OWNER) > 0:
            return  # 已有公共题库，避免每次启动重复扫描导入

        total = 0
        for path in files:
            try:
                items = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"种子文件解析失败，已跳过：{path.name}（{exc}）")
                continue
            added, _, _ = import_items(db, items)
            total += added
        db.commit()

    print(f"首次启动：已从 {len(files)} 个种子文件导入 {total} 道公共题。")
