"""云库（在线开局/局面库）客户端。

开局阶段的最优着法在云端棋谱库中高度收敛，直接查询可以：
- 让引擎在开局阶段秒回着法，省下一次完整搜索（降低服务器 CPU 压力）；
- 给前端提供「云库着法」面板（着法 + 评分 + 胜率）。

实现要点：
- 仅用标准库 urllib，不引入新依赖；
- 进程内 TTL 缓存（开局局面高度重复，命中后零外网请求）；
- 连续失败自动熔断一段时间，网络不可用时不拖慢对弈主流程；
- 任何网络/解析异常都静默降级为「无数据」。

环境变量：
- XQ_CLOUDBOOK        ："0" 关闭（默认开启）
- XQ_CLOUDBOOK_URL    ：查询接口地址（默认 chessdb 公共云库）
- XQ_CLOUDBOOK_TIMEOUT：单次查询超时秒数（默认 1.5）
- XQ_CLOUDBOOK_MAX_PLY：引擎走子参考云库的最大步数（默认 24，即前 12 回合）
"""
from __future__ import annotations

import os
import random
import time
import urllib.parse
import urllib.request

DEFAULT_URL = "https://www.chessdb.cn/chessdb.php"

# fen(前两段) -> (过期时间戳, moves 列表)
_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL = 6 * 3600
_CACHE_MAX = 5000

# 连续失败熔断：失败 _BREAK_AFTER 次后，_BREAK_SECS 秒内不再发起外网请求
_fail_count = 0
_break_until = 0.0
_BREAK_AFTER = 3
_BREAK_SECS = 300


def enabled() -> bool:
    return os.getenv("XQ_CLOUDBOOK", "1") != "0"


def _timeout() -> float:
    try:
        return float(os.getenv("XQ_CLOUDBOOK_TIMEOUT", "1.5"))
    except ValueError:
        return 1.5


def _max_ply() -> int:
    try:
        return int(os.getenv("XQ_CLOUDBOOK_MAX_PLY", "24"))
    except ValueError:
        return 24


def _fen_key(fen: str) -> str:
    """缓存/查询只关心棋子摆放与走子方。"""
    parts = fen.split()
    return " ".join(parts[:2]) if len(parts) >= 2 else fen


def ply_of(fen: str) -> int:
    """根据 FEN 的回合数与走子方估算当前是第几个半着（从 0 开始）。"""
    parts = fen.split()
    side = parts[1] if len(parts) > 1 else "w"
    try:
        fullmove = int(parts[5])
    except (IndexError, ValueError):
        fullmove = 1
    return (fullmove - 1) * 2 + (0 if side == "w" else 1)


def _fetch(fen_key: str) -> str:
    """发起一次云库查询，返回原始响应文本。独立成函数便于测试替换。"""
    url = os.getenv("XQ_CLOUDBOOK_URL", DEFAULT_URL)
    qs = urllib.parse.urlencode({"action": "queryall", "board": fen_key + " - - 0 1"})
    req = urllib.request.Request(f"{url}?{qs}", headers={"User-Agent": "xiangqidao/1.0"})
    with urllib.request.urlopen(req, timeout=_timeout()) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_response(text: str) -> list[dict]:
    """解析云库响应为着法列表。

    响应形如 ``move:h2e2,score:30,rank:2,note:!,winrate:54.3|move:...``，
    可能以 \\0 结尾；``unknown`` / ``invalid board`` 等表示无数据。
    score 为走子方视角（正=走子方占优）。
    """
    text = text.strip().strip("\0").strip()
    if not text or ":" not in text:
        return []
    moves = []
    for item in text.split("|"):
        fields: dict[str, str] = {}
        for seg in item.split(","):
            if ":" in seg:
                k, v = seg.split(":", 1)
                fields[k.strip()] = v.strip()
        uci = fields.get("move", "")
        if len(uci) < 4:
            continue
        entry: dict = {"uci": uci}
        for key in ("score", "rank"):
            try:
                entry[key] = int(fields[key])
            except (KeyError, ValueError):
                entry[key] = None
        try:
            entry["winrate"] = float(fields["winrate"])
        except (KeyError, ValueError):
            entry["winrate"] = None
        entry["note"] = fields.get("note") or None
        moves.append(entry)
    # 按评分从高到低稳定排序（None 视为最差）
    moves.sort(key=lambda m: m["score"] if m["score"] is not None else -10**9, reverse=True)
    return moves


def query_book(fen: str) -> list[dict] | None:
    """查询给定局面的云库着法。

    返回着法列表（可能为空），云库关闭/不可用时返回 None。
    """
    global _fail_count, _break_until
    if not enabled():
        return None
    key = _fen_key(fen)
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    if now < _break_until:
        return None
    try:
        moves = parse_response(_fetch(key))
    except Exception:
        _fail_count += 1
        if _fail_count >= _BREAK_AFTER:
            _break_until = now + _BREAK_SECS
            _fail_count = 0
        return None
    _fail_count = 0
    if len(_cache) >= _CACHE_MAX:
        _cache.clear()
    _cache[key] = (now + _CACHE_TTL, moves)
    return moves


def best_book_move(fen: str, level: str = "hard") -> str | None:
    """为引擎走子挑一个云库着法；不适用时返回 None（由引擎搜索兜底）。

    - 仅在开局阶段（前 XQ_CLOUDBOOK_MAX_PLY 个半着）参考云库；
    - hard 走库中最优；medium 在接近最优（差距 ≤50cp）的着法里随机，保持多样性；
    - easy 不用云库，避免开局过强。
    """
    if level == "easy" or ply_of(fen) >= _max_ply():
        return None
    moves = query_book(fen)
    if not moves:
        return None
    scored = [m for m in moves if m["score"] is not None]
    if not scored:
        return None
    best = scored[0]
    if level != "hard":
        top = best["score"]
        pool = [m for m in scored if top - m["score"] <= 50]
        return random.choice(pool)["uci"]
    return best["uci"]
