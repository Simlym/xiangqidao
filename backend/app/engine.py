"""Pikafish UCI 引擎封装。"""
import os
import re
import subprocess
import shutil
import threading
from dataclasses import dataclass


def find_engine() -> str | None:
    """定位 Pikafish 可执行文件：优先「管理后台一键安装」的受管目录，其次回退 PATH。"""
    try:
        from .engine_install import binary_path

        p = binary_path()
        if os.path.isfile(p):
            return p
    except Exception:
        pass
    return shutil.which("pikafish")

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


@dataclass
class MoveEval:
    best_move: str | None
    score_cp: int | None      # centipawn，正=当前方有利
    score_mate: int | None    # 几步杀，None=无强制杀
    pv: list[str] | None = None  # 主变着法序列（己方/对方交替），用于生成多步题
    depth: int | None = None
    seldepth: int | None = None
    nodes: int | None = None
    nps: int | None = None
    time_ms: int | None = None
    wdl: tuple[int, int, int] | None = None
    lines: list[dict] | None = None


class Engine:
    def __init__(self, path=None):
        self.path = path or find_engine()
        if not self.path:
            raise FileNotFoundError(
                "找不到 pikafish 可执行文件，请在管理后台一键安装，或将其加入 PATH。"
            )
        # 以可执行文件所在目录为工作目录，便于默认加载同目录下的 pikafish.nnue
        workdir = os.path.dirname(self.path) or None
        self.proc = subprocess.Popen(
            [self.path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=workdir,
        )
        # UCI 是有状态的串行协议；单例复用时需保证一次只有一个调用方在收发
        self._lock = threading.Lock()
        self._cmd("uci")
        self._wait_for("uciok")
        # 显式指定 NNUE 权重路径，避免工作目录差异导致评估网络加载失败
        nnue = os.path.join(workdir, "pikafish.nnue") if workdir else None
        if nnue and os.path.isfile(nnue):
            self._cmd(f"setoption name EvalFile value {os.path.abspath(nnue)}")
        self._cmd("isready")
        self._wait_for("readyok")

    def is_alive(self) -> bool:
        return self.proc.poll() is None

    def new_game(self) -> None:
        """开始一局新分析/对局：清空引擎置换表。每局只需调用一次。"""
        with self._lock:
            self._cmd("ucinewgame")
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

    def analyze(
        self, fen: str, depth: int = 16, *, mode: str = "depth",
        value: int | None = None, multipv: int = 1, show_wdl: bool = False,
        search_moves: list[str] | None = None, on_info=None,
        cancel_event: threading.Event | None = None,
    ) -> MoveEval:
        """分析局面，返回最优着法和评分。

        不再每次发送 ucinewgame —— 逐局面分析时复用置换表能显著提速；
        需要清空状态时由调用方在新局开始处调用 new_game()。
        """
        with self._lock:
            multipv = max(1, min(10, int(multipv)))
            self._cmd(f"setoption name MultiPV value {multipv}")
            if show_wdl:
                self._cmd("setoption name UCI_ShowWDL value true")
            self._cmd(f"position fen {fen}")
            if mode == "infinite":
                go = "go infinite"
            elif mode == "movetime":
                go = f"go movetime {max(50, int(value or 1000))}"
            else:
                go = f"go depth {max(1, int(value or depth))}"
            if search_moves:
                go += " searchmoves " + " ".join(search_moves)
            self._cmd(go)

            assert self.proc.stdout

            best_move: str | None = None
            score_cp: int | None = None
            score_mate: int | None = None
            latest: dict[int, dict] = {}
            stopped = False

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

                    mp_m = re.search(r"\bmultipv (\d+)", line)
                    mp = int(mp_m.group(1)) if mp_m else 1
                    current = latest.get(mp, {})
                    if d < current.get("depth", -1):
                        continue

                    # 解析 score
                    sc_cp = re.search(r"\bscore cp (-?\d+)", line)
                    sc_mate = re.search(r"\bscore mate (-?\d+)", line)

                    # 解析整条 pv（着法序列）
                    pv_m = re.search(r"\bpv (.+)$", line)

                    current = {**current, "multipv": mp, "depth": d}
                    for key, pattern in (
                        ("seldepth", r"\bseldepth (\d+)"), ("nodes", r"\bnodes (\d+)"),
                        ("nps", r"\bnps (\d+)"), ("time_ms", r"\btime (\d+)"),
                    ):
                        match = re.search(pattern, line)
                        if match:
                            current[key] = int(match.group(1))
                    if sc_cp:
                        current["score_cp"] = int(sc_cp.group(1))
                        current["score_mate"] = None
                    elif sc_mate:
                        current["score_mate"] = int(sc_mate.group(1))
                        current["score_cp"] = None
                    wdl_m = re.search(r"\bwdl (\d+) (\d+) (\d+)", line)
                    if wdl_m:
                        current["wdl"] = tuple(map(int, wdl_m.groups()))
                    if pv_m:
                        current["pv"] = re.findall(
                            r"[a-i][0-9][a-i][0-9][a-zA-Z]{0,2}", pv_m.group(1)
                        )
                    latest[mp] = current
                    if on_info:
                        on_info({**current})
                    if cancel_event is not None and cancel_event.is_set() and not stopped:
                        self._cmd("stop")
                        stopped = True

        lines = [latest[key] for key in sorted(latest)]
        first = lines[0] if lines else {}
        score_cp = first.get("score_cp")
        score_mate = first.get("score_mate")
        pv_line = first.get("pv")
        pv_move = pv_line[0] if pv_line else None
        # pv 第一着优先，bestmove 保底
        final_best = pv_move or best_move

        return MoveEval(
            best_move=final_best,
            score_cp=score_cp,
            score_mate=score_mate,
            pv=pv_line,
            depth=first.get("depth"),
            seldepth=first.get("seldepth"),
            nodes=first.get("nodes"),
            nps=first.get("nps"),
            time_ms=first.get("time_ms"),
            wdl=first.get("wdl"),
            lines=lines,
        )

    def close(self) -> None:
        try:
            self._cmd("quit")
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def get_engine(path=None) -> Engine | None:
    """返回新的 Engine 实例；引擎未安装时返回 None（不报错）。"""
    try:
        return Engine(path=path)
    except FileNotFoundError:
        return None


# ── 进程级单例 ──────────────────────────────────────────────────
# 每次对弈/分析都新起一个 Pikafish 进程要重做 uci 握手，开销极大。
# 这里维护一个可复用的共享实例；analyze() 内部已用锁串行化收发。

_shared: Engine | None = None
_no_engine = False           # 已确认未安装 Pikafish，避免反复探测
_shared_lock = threading.Lock()


def get_shared_engine(path=None) -> Engine | None:
    """返回可复用的共享 Engine；未安装则返回 None 并记住，避免反复探测。

    若已有实例但其进程已退出，则自动重建。
    """
    global _shared, _no_engine
    with _shared_lock:
        if _shared is not None and _shared.is_alive():
            return _shared
        if _no_engine:
            return None
        _shared = get_engine(path)
        if _shared is None:
            _no_engine = True
        return _shared


def reset_shared_engine() -> None:
    """丢弃共享实例并清除「未安装」记忆，使下次调用重新探测引擎。

    用于管理后台安装/卸载 Pikafish 后立即生效，无需重启进程。
    """
    global _shared, _no_engine
    with _shared_lock:
        if _shared is not None:
            try:
                _shared.close()
            except Exception:
                pass
        _shared = None
        _no_engine = False
