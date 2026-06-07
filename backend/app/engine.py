"""Pikafish UCI 引擎封装。"""
import re
import subprocess
import shutil
from dataclasses import dataclass

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


@dataclass
class MoveEval:
    best_move: str | None
    score_cp: int | None      # centipawn，正=当前方有利
    score_mate: int | None    # 几步杀，None=无强制杀


class Engine:
    def __init__(self, path=None):
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

    def analyze(self, fen: str, depth: int = 16) -> MoveEval:
        """分析局面，返回最优着法和评分。"""
        self._cmd("ucinewgame")
        self._cmd(f"position fen {fen}")
        self._cmd(f"go depth {depth}")

        assert self.proc.stdout

        best_move: str | None = None
        score_cp: int | None = None
        score_mate: int | None = None
        best_depth = -1
        pv_move: str | None = None

        for line in self.proc.stdout:
            line = line.strip()

            if line.startswith("bestmove"):
                parts = line.split()
                mv = parts[1] if len(parts) > 1 else None
                best_move = None if mv in (None, "(none)") else mv
                break

            if line.startswith("info"):
                # 解析 depth
                dm = re.search(r"\bdepth (\d+)", line)
                if not dm:
                    continue
                d = int(dm.group(1))

                # 解析 score
                sc_cp = re.search(r"\bscore cp (-?\d+)", line)
                sc_mate = re.search(r"\bscore mate (-?\d+)", line)

                # 解析 pv 第一着
                pv_m = re.search(r"\bpv ([a-i][0-9][a-i][0-9])", line)

                if d > best_depth:
                    best_depth = d
                    if sc_cp:
                        score_cp = int(sc_cp.group(1))
                        score_mate = None
                    elif sc_mate:
                        score_mate = int(sc_mate.group(1))
                        score_cp = None
                    pv_move = pv_m.group(1) if pv_m else None

        # pv_move 优先，bestmove 保底
        final_best = pv_move or best_move

        return MoveEval(
            best_move=final_best,
            score_cp=score_cp,
            score_mate=score_mate,
        )

    def close(self) -> None:
        try:
            self._cmd("quit")
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def get_engine(path=None) -> Engine | None:
    """返回 Engine 实例；引擎未安装时返回 None（不报错）。"""
    try:
        return Engine(path=path)
    except FileNotFoundError:
        return None
