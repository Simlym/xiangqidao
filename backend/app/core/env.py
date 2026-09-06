"""以标准库实现 .env 配置文件加载,不引入新依赖。

优先级:真实环境变量 > .env 文件 > 代码内默认值,因此部署平台
(Docker、systemd 等)传入的环境变量始终生效,.env 只做本地默认值。

查找顺序(取第一个存在的文件):
1. ENV_FILE 显式指定的路径;
2. 当前工作目录下的 .env;
3. backend/.env(本文件上两级目录)。
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# 是否已尝试加载过(load_dotenv 幂等,避免重复解析)
_attempted = False


def _candidates() -> list[Path]:
    """按优先级列出可能的 .env 路径。"""
    paths: list[Path] = []
    explicit = os.environ.get("ENV_FILE", "").strip()
    if explicit:
        paths.append(Path(explicit))
    paths.append(Path.cwd() / ".env")
    # app/core/env.py 的上两级即 backend/ 目录
    paths.append(Path(__file__).resolve().parents[2] / ".env")
    return paths


def parse_env_text(text: str) -> dict[str, str]:
    """解析 .env 文本为键值对。

    支持:`#` 整行注释、`export ` 前缀、成对单/双引号包裹
    (保留内部空格与 #)、未加引号时的行内注释(`值 # 说明`)。
    键名不合法或没有 `=` 的行直接忽略,不抛异常。
    """
    result: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export ") or line.startswith("export\t"):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not _KEY_RE.match(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            cut = re.search(r"\s#", value)  # 行内注释需 # 前有空白,避免误伤 URL 锚点
            if cut:
                value = value[: cut.start()].rstrip()
        result[key] = value
    return result


def load_dotenv(force: bool = False) -> Path | None:
    """把首个存在的 .env 内容注入 os.environ,返回加载的文件路径。

    - 已存在于环境中的键不覆盖(环境变量优先);
    - 幂等:首次调用后不再重复解析,force=True 强制重读(供测试);
    - pytest 环境下自动跳过(除非 ENV_FILE 显式指定),
      保证测试不受本机 .env 影响。
    """
    global _attempted
    if _attempted and not force:
        return None
    _attempted = True
    if "pytest" in sys.modules and not os.environ.get("ENV_FILE", "").strip():
        return None
    for path in _candidates():
        try:
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8-sig")
        except OSError:
            continue
        for key, value in parse_env_text(text).items():
            if key not in os.environ:
                os.environ[key] = value
        return path
    return None
