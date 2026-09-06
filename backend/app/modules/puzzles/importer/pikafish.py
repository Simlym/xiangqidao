"""Pikafish (UCI) 封装。

第一版只用它做一件事：批量校验题库里的'正解'是否确为引擎认可的最优着法，
从而过滤脏数据。不在用户交互路径上 —— 没装引擎也不影响刷题。

用法:
    eng = Pikafish("/path/to/pikafish")
    best = eng.bestmove(fen, movetime_ms=1000)
    eng.close()
"""

from __future__ import annotations

import subprocess
import shutil


class Pikafish:
    def __init__(self, path: str | None = None):
        self.path = path or shutil.which("pikafish")
        if not self.path:
            raise FileNotFoundError(
                "找不到 pikafish 可执行文件，请安装后将其加入 PATH 或显式传入路径。"
            )
        self.proc = subprocess.Popen(
            [self.path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._cmd("uci")
        self._wait_for("uciok")
        self._cmd("isready")
        self._wait_for("readyok")

    def _cmd(self, c: str) -> None:
        assert self.proc.stdin
        self.proc.stdin.write(c + "\n")
        self.proc.stdin.flush()

    def _wait_for(self, token: str) -> list[str]:
        assert self.proc.stdout
        lines: list[str] = []
        for line in self.proc.stdout:
            lines.append(line.strip())
            if line.startswith(token):
                break
        return lines

    def bestmove(self, fen: str, movetime_ms: int = 1000) -> str | None:
        """返回引擎给出的最优着法（UCI 坐标制），如 'h2e2'。"""
        self._cmd("ucinewgame")
        self._cmd(f"position fen {fen}")
        self._cmd(f"go movetime {movetime_ms}")
        assert self.proc.stdout
        for line in self.proc.stdout:
            line = line.strip()
            if line.startswith("bestmove"):
                parts = line.split()
                mv = parts[1] if len(parts) > 1 else None
                return None if mv in (None, "(none)") else mv
        return None

    def close(self) -> None:
        try:
            self._cmd("quit")
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
