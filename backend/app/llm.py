"""通用 LLM 调用：OpenAI Chat、OpenAI Responses 与 Anthropic Messages。"""
import logging
import time

import httpx

from .settings import (
    PROTOCOL_ANTHROPIC,
    PROTOCOL_OPENAI_CHAT,
    PROTOCOL_OPENAI_RESPONSES,
    get_llm_config,
)
from .xiangqi_utils import apply_move, render_board, uci_to_chinese

# 记录提示词 / 模型思考 / 输出，均为 DEBUG 级。是否可见由全局日志等级统一控制
# （后台「系统日志」页可调到 DEBUG 查看；见 app/log_buffer.py）。
logger = logging.getLogger("xiangqidao.llm")

# 用户强度到服务实际强度的统一映射。
_EFFORT_MAP = {"low": "low", "medium": "high", "high": "high", "xhigh": "high", "max": "max"}
# max_tokens / max_output_tokens 通常同时包含思考和最终正文；开启思考时额外预留预算。
_REASONING_BUDGET = {"low": 1500, "high": 5000, "max": 8000}
_REASONING_TIMEOUT = {"low": 60, "high": 75, "max": 120}

# 仅对已维护单价的模型估算费用；未知服务/模型记为 0，避免产生虚假账单。
_PRICING = {
    "deepseek-v4-flash": {"cache_hit": 0.0028, "cache_miss": 0.14, "output": 0.28},
    "deepseek-v4-pro": {"cache_hit": 0.003625, "cache_miss": 0.435, "output": 0.87},
}
_DEFAULT_PRICING = {"cache_hit": 0.0, "cache_miss": 0.0, "output": 0.0}


def _compute_cost(model: str, prompt_tokens: int, cached_tokens: int,
                  completion_tokens: int) -> float:
    """据价格表算单次调用费用（USD）。prompt 中命中缓存的部分按更低的缓存单价计。"""
    p = _PRICING.get(model, _DEFAULT_PRICING)
    miss = max(prompt_tokens - cached_tokens, 0)  # 未命中缓存的 prompt token
    cost = (
        cached_tokens * p["cache_hit"]
        + miss * p["cache_miss"]
        + completion_tokens * p["output"]
    ) / 1_000_000
    return round(cost, 8)


def _describe_position(fen: str) -> str:
    """把 FEN 渲染成「棋盘图」文本供大模型阅读，避免其自行解析 FEN 出错。"""
    return render_board(fen)


def _describe_moves(fen: str, ucis: list[str]) -> str:
    """把一串 UCI 着法逐手转成「中文棋谱（UCI）」，并沿途推进局面以正确命名。"""
    out = []
    cur = fen
    for uci in ucis:
        zh = uci_to_chinese(cur, uci)
        out.append(f"{zh}（{uci}）")
        try:
            cur = apply_move(cur, uci)
        except Exception:
            break
    return " → ".join(out)

def _endpoint(base_url: str, suffix: str) -> str:
    """允许填写服务根地址，也允许直接填写完整接口地址。"""
    base = base_url.rstrip("/")
    return base if base.endswith(suffix) else f"{base}/{suffix.lstrip('/')}"


def _request_parts(cfg, prompt: str, max_tokens: int) -> tuple[str, dict, dict]:
    """按协议生成 URL、请求头和请求体。"""
    effort = _EFFORT_MAP.get(cfg.reasoning_effort, "high")
    if cfg.protocol == PROTOCOL_OPENAI_CHAT:
        body = {
            "model": cfg.model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "thinking": {"type": "enabled" if cfg.thinking_enabled else "disabled"},
        }
        if cfg.thinking_enabled:
            body["reasoning_effort"] = effort
        return (
            _endpoint(cfg.base_url, "/chat/completions"),
            {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"},
            body,
        )
    if cfg.protocol == PROTOCOL_OPENAI_RESPONSES:
        return (
            _endpoint(cfg.base_url, "/responses"),
            {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"},
            {"model": cfg.model, "input": prompt, "max_output_tokens": max_tokens},
        )
    if cfg.protocol == PROTOCOL_ANTHROPIC:
        body = {
            "model": cfg.model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "reasoning": {"effort": effort if cfg.thinking_enabled else "none"},
        }
        if cfg.thinking_enabled:
            body["output_config"] = {"effort": effort}
        return (
            _endpoint(cfg.base_url, "/messages"),
            {"x-api-key": cfg.api_key, "anthropic-version": "2023-06-01",
             "Content-Type": "application/json"},
            body,
        )
    raise ValueError(f"不支持的 LLM 协议：{cfg.protocol}")


def _normalize_usage(protocol: str, usage: dict | None) -> dict:
    """把三种协议的用量字段归一为 OpenAI Chat 风格，供既有记账逻辑使用。"""
    usage = usage or {}
    if protocol == PROTOCOL_OPENAI_CHAT:
        return usage
    prompt = int(usage.get("input_tokens", 0) or 0)
    completion = int(usage.get("output_tokens", 0) or 0)
    cached = int(usage.get("cache_read_input_tokens", 0) or 0)
    input_details = usage.get("input_tokens_details") or {}
    cached = int(input_details.get("cached_tokens", cached) or 0)
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
        "prompt_tokens_details": {"cached_tokens": cached},
    }


def _content_text(content) -> str:
    """兼容纯字符串以及常见的结构化文本块。"""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return content.get("text", "") if content.get("type") in {"text", "output_text"} else ""
    if isinstance(content, list):
        return "".join(
            item.get("text", "") for item in content
            if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
        )
    return ""


def _response_text(protocol: str, data: dict) -> tuple[str, str, str]:
    """返回（正文、推理文本、结束原因）。"""
    if protocol == PROTOCOL_OPENAI_CHAT:
        choice = data["choices"][0]
        message = choice["message"]
        return (
            _content_text(message.get("content")).strip(),
            message.get("reasoning_content") or "",
            choice.get("finish_reason") or "",
        )
    if protocol == PROTOCOL_OPENAI_RESPONSES:
        text = data.get("output_text") or ""
        if not text:
            parts = []
            for item in data.get("output") or []:
                for content in item.get("content") or []:
                    if content.get("type") in {"output_text", "text"}:
                        parts.append(_content_text(content))
            text = "".join(parts)
        return text.strip(), "", data.get("status") or ""
    parts = [_content_text(item) for item in data.get("content") or []
             if item.get("type") == "text"]
    return "".join(parts).strip(), "", data.get("stop_reason") or ""


def _record_call(feature: str, user_id: str, model: str, usage: dict | None,
                 duration_ms: int, success: bool, error: str, ref: str) -> None:
    """把单次 LLM 调用的 token/费用落库到 llm_call_logs。失败绝不影响主流程。"""
    usage = usage or {}
    prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
    completion_tokens = int(usage.get("completion_tokens", 0) or 0)
    total_tokens = int(usage.get("total_tokens", 0) or 0) or (prompt_tokens + completion_tokens)
    # 各协议已尽量归一到 prompt_tokens_details.cached_tokens。
    details = usage.get("prompt_tokens_details") or {}
    cached_tokens = int(details.get("cached_tokens", usage.get("prompt_cache_hit_tokens", 0)) or 0)
    # thinking 的 reasoning token 计入 completion，单独记录便于分析
    cdetails = usage.get("completion_tokens_details") or {}
    reasoning_tokens = int(cdetails.get("reasoning_tokens", 0) or 0)
    cost = _compute_cost(model, prompt_tokens, cached_tokens, completion_tokens)

    logger.debug(
        "LLM 用量 feature=%s user=%s model=%s prompt=%d(cache=%d) completion=%d(reason=%d) "
        "total=%d cost=$%.6f %dms success=%s",
        feature, user_id or "-", model, prompt_tokens, cached_tokens,
        completion_tokens, reasoning_tokens, total_tokens, cost, duration_ms, success,
    )
    try:
        from .models import LLMCallLog, SessionLocal

        db = SessionLocal()
        try:
            db.add(LLMCallLog(
                feature=feature, user_id=user_id or "", model=model,
                prompt_tokens=prompt_tokens, cached_tokens=cached_tokens,
                completion_tokens=completion_tokens, reasoning_tokens=reasoning_tokens,
                total_tokens=total_tokens, cost_usd=cost, duration_ms=duration_ms,
                success=success, error=error[:200], ref=ref[:80],
            ))
            db.commit()
        finally:
            db.close()
    except Exception:  # noqa: BLE001 — 用量记账失败不应阻断业务
        logger.warning("LLM 用量落库失败", exc_info=True)


def _chat(prompt: str, max_tokens: int = 200, timeout: int = 15,
          feature: str = "unknown", user_id: str = "", ref: str = "") -> str:
    """调用当前配置的 LLM，未启用、未配置或失败时返回空字符串。"""
    text, _ = _chat_raw(prompt, max_tokens=max_tokens, timeout=timeout,
                        feature=feature, user_id=user_id, ref=ref)
    return text


def _chat_raw(prompt: str, max_tokens: int = 200, timeout: int = 15,
              feature: str = "unknown", user_id: str = "", ref: str = "",
              config=None) -> tuple[str, str]:
    """调用当前配置的 LLM，返回 (正文, 错误信息)。

    成功时错误信息为空串；失败时正文为空串、错误信息为可读的原因（供后台测试透传定位）。
    每次调用（无论成败、只要真正发出了请求）都把 token 用量与费用落库供审计。
    feature/user_id/ref 标识本次调用的事项、触发者与关联对象。
    """
    cfg = config or get_llm_config()
    if not cfg.active:
        return "", "未启用或未配置密钥"
    effort = _EFFORT_MAP.get(cfg.reasoning_effort, "high")
    output_budget = max_tokens
    if cfg.thinking_enabled:
        output_budget += _REASONING_BUDGET[effort]
        timeout = max(timeout, _REASONING_TIMEOUT[effort])
    url, headers, body = _request_parts(cfg, prompt, output_budget)

    logger.debug(
        "===== LLM 请求 feature=%s protocol=%s model=%s output_budget=%d timeout=%ss =====\n%s",
        feature, cfg.protocol, cfg.model, output_budget, timeout, prompt,
    )
    started = time.monotonic()

    def _elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                url,
                headers=headers,
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
            usage = _normalize_usage(cfg.protocol, data.get("usage"))
            content, reasoning, finish = _response_text(cfg.protocol, data)
            if reasoning:
                logger.debug("----- 模型思考 -----\n%s", reasoning)
            logger.debug("----- 模型输出 (finish_reason=%s) -----\n%s", finish, content)
            if not content:
                # 正文为空：多半是 token 预算被思考耗尽（finish_reason=length）。
                # 绝不把截断的思考当成答案返回，否则就是“乱分析”。
                reason = "正文为空（思考耗尽预算）" if finish == "length" else "正文为空"
                logger.warning("LLM %s finish_reason=%s", reason, finish)
                # 即便正文为空也已实际消耗 token，照常记账
                _record_call(feature, user_id, cfg.model, usage, _elapsed_ms(),
                             False, reason, ref)
                return "", reason
            _record_call(feature, user_id, cfg.model, usage, _elapsed_ms(), True, "", ref)
            return content, ""
    except httpx.HTTPStatusError as e:
        status = e.response.status_code if e.response is not None else "?"
        body_text = e.response.text[:300] if e.response is not None else ""
        logger.warning("LLM HTTP %s: %s", status, body_text)
        # 请求失败通常未产生 token 费用（usage 缺失），仍记一笔失败便于排查
        _record_call(feature, user_id, cfg.model, None, _elapsed_ms(),
                     False, f"HTTP {status}", ref)
        return "", f"HTTP {status}: {body_text}"
    except Exception as e:
        logger.warning("LLM 调用异常", exc_info=True)
        _record_call(feature, user_id, cfg.model, None, _elapsed_ms(),
                     False, f"{type(e).__name__}: {e}", ref)
        return "", f"{type(e).__name__}: {e}"


def summarize_game(
    result: str,                 # 对局结果，如 "红胜"/"黑胜"/"和棋"
    human_side: str,             # 复盘视角："红方"/"黑方"，空串表示不指定
    total_moves: int,
    mistakes: list[dict],        # [{move_number, side, eval_drop_cp, severity, explanation}]
    user_id: str = "",
    ref: str = "",
) -> str:
    """生成整局综合复盘报告（中文）。未配置 key 时返回空串。"""
    if not mistakes:
        lines = "本局未检出明显失误。"
    else:
        rows = []
        for m in mistakes[:12]:  # 控制 prompt 长度，取前若干处关键失误
            drop = m.get("eval_drop_cp", 0) / 100
            rows.append(
                f"- 第{m['move_number']}手（{m['side']}，{m['severity']}，失分约{drop:.1f}子）："
                f"{m.get('explanation') or '（无逐步解释）'}"
            )
        lines = "\n".join(rows)

    perspective = f"以{human_side}视角" if human_side else "客观"
    prompt = f"""你是资深象棋教练，请{perspective}为下面这局棋写一份简短的综合复盘报告（中文，150字以内）。

对局结果：{result}
总手数：{total_moves}
检出的主要失误如下：
{lines}

请分三部分：① 本局整体表现与转折点；② 暴露的主要问题（棋理层面，如计算、子力协调、攻防转换）；③ 一条最值得改进的建议。
用象棋术语，简洁专业，不要逐手复述，不要输出坐标。"""
    return _chat(prompt, max_tokens=400, timeout=30,
                 feature="summarize_game", user_id=user_id, ref=ref)


def explain_puzzle(
    fen: str,
    solution: list[str],   # 正解着法序列（UCI，己方/对方交替）
    category: str,         # 战术名目，如 "卧槽马"
    side: str,             # "红方" / "黑方"
    user_id: str = "",
    ref: str = "",
) -> str:
    """讲解一道战术题的解题思路（中文）。未配置 key 时返回空串。"""
    board = _describe_position(fen)
    seq = _describe_moves(fen, solution)
    prompt = f"""你是象棋教练。请讲解下面这道战术题的解题思路（中文，3-5句）。

当前局面（棋盘图）：
{board}

轮到{side}走子，战术主题：{category or "未分类"}
正解着法序列（中文棋谱，括号内为UCI坐标，己方与对方应着交替）：{seq}

请严格依据上面的棋盘图与正解着法作答，不要臆测图上不存在的棋子。说明：
① 这个杀法/战术的核心思路与子力配合；② 为什么对方无法解拆；③ 实战中识别此类机会的要点。
不要复述坐标，用象棋术语描述（如"卧槽马""双车错""闷宫"等），简洁专业。"""
    return _chat(prompt, max_tokens=400, timeout=30,
                 feature="explain_puzzle", user_id=user_id, ref=ref)


def coach_move(
    fen: str,
    move: str,     # 推荐着法 UCI
    side: str,     # "红方" / "黑方"
    user_id: str = "",
    ref: str = "",
) -> str:
    """点评一步推荐着法好在哪里（中文，2-3句）。未配置 key 时返回空串。"""
    board = _describe_position(fen)
    move_zh = uci_to_chinese(fen, move)
    prompt = f"""你是象棋教练。引擎推荐了一步棋，请简短解释这步棋的意图（中文，2-3句）。

当前局面（棋盘图）：
{board}

轮到{side}走子，推荐着法：{move_zh}（{move}）

请严格依据上面的棋盘图作答，说明这步棋的战术/战略意图（如抢先手、控线、兑子简化、做杀等）。
不要复述坐标，用象棋术语描述。"""
    return _chat(prompt, max_tokens=200, timeout=30,
                 feature="coach_move", user_id=user_id, ref=ref)


def _progress_lines(progress: dict | None) -> str:
    """把确定性算出的进步对比指标整理成 prompt 片段；无基线返回空串。"""
    if not progress:
        return ""
    lines = [f"进步对比（与 {progress.get('days_span', 0)} 天前的基线相比）："]

    def _pp(v):  # 比率差值 → 百分点
        return f"{'+' if v >= 0 else ''}{round(v * 100)} 个百分点"

    if progress.get("rating_delta") is not None:
        d = progress["rating_delta"]
        lines.append(f"- 评分变化：{'+' if d >= 0 else ''}{round(d)}")
    if progress.get("solved_delta"):
        lines.append(f"- 新结算题数：{round(progress['solved_delta'])} 道")
    if progress.get("first_try_accuracy_delta") is not None:
        lines.append(f"- 首答正确率变化：{_pp(progress['first_try_accuracy_delta'])}")
    if progress.get("weak_fixed"):
        lines.append(f"- 已脱离弱点区的类目：{'、'.join(progress['weak_fixed'])}")
    if progress.get("weak_new"):
        lines.append(f"- 新暴露的弱点类目：{'、'.join(progress['weak_new'])}")
    before, now = progress.get("blunders_per_game_before"), progress.get("blunders_per_game_now")
    if before is not None and now is not None:
        lines.append(f"- 场均严重失误：{before} → {now}")
    return "\n".join(lines) if len(lines) > 1 else ""


def write_coach_plan(
    profile: dict,
    recommendations: list[dict],
    progress: dict | None = None,
    user_id: str = "",
    ref: str = "",
) -> str:
    """据用户画像写个性化训练计划叙述（中文）。未配置 key 时返回空串。

    画像、建议与进步对比均为规则引擎产出的事实，LLM 只做「教练口吻」的解读与编排。
    """
    weak = profile.get("weak_categories") or []
    weak_line = (
        "、".join(f"{w['category']}（正确率{round(w['accuracy'] * 100)}%）" for w in weak)
        if weak
        else "暂未发现明显弱点类目"
    )
    games = profile.get("recent_games") or []
    if games:
        blunders = sum(g["blunders"] for g in games)
        mistakes = sum(g["mistakes"] for g in games)
        games_line = f"已复盘 {len(games)} 局，共检出 {blunders} 处严重失误、{mistakes} 处一般失误"
    else:
        games_line = "近期暂无已复盘的对局"

    def _pct(v):
        return f"{round(v * 100)}%" if v is not None else "暂无数据"

    rec_lines = "\n".join(f"{i + 1}. {r['reason']}" for i, r in enumerate(recommendations))
    prog_block = _progress_lines(progress)
    prog_section = f"\n{prog_block}\n" if prog_block else ""
    first_part = (
        "① 水平评估与进步点评（点明现在大概什么水平；结合上面的进步对比，"
        "肯定具体进步、指出退步并分析原因）"
        if prog_block
        else "① 水平评估（一两句，点明现在大概什么水平、最近状态如何）"
    )

    prompt = f"""你是资深象棋教练，请基于学员档案写一份个性化训练计划（中文，260字以内）。

学员档案：
- 当前评分：{profile.get('rating')}（{profile.get('title')}），历史最高 {profile.get('peak')}，已结算 {profile.get('solved')} 题
- 首答正确率：总体 {_pct(profile.get('first_try_accuracy'))}，最近20题 {_pct(profile.get('recent20_first_try_accuracy'))}
- 弱点类目：{weak_line}
- 近期对局：{games_line}
- 今日到期复习 {profile.get('due_today')} 题；待练实战漏算题 {profile.get('pending_blunder_puzzles')} 道
{prog_section}
系统给出的训练安排（已按优先级排序）：
{rec_lines}

请分三部分：{first_part}；
② 主要短板与棋理成因（如计算深度、子力协调、杀法熟练度）；
③ 本阶段训练安排（结合上面系统建议给出执行顺序与目标）。最后一句简短鼓励。
口吻像面对面指导的老师，具体、可执行，不要空话，不要列举数字以外的坐标。"""
    return _chat(prompt, max_tokens=550, timeout=30,
                 feature="coach_plan", user_id=user_id, ref=ref)


def explain_mistake(
    fen: str,
    move_played: str,      # UCI，如 "h2e2"
    best_move: str,        # UCI
    score_drop_cp: int,    # 失分（正值=失分）
    move_number: int,
    side: str,             # "红方" / "黑方"
    user_id: str = "",
    ref: str = "",
) -> str:
    """调用当前配置的 LLM 解释这步失误；未配置时返回空字符串。"""
    board = _describe_position(fen)
    played_zh = uci_to_chinese(fen, move_played)
    best_zh = uci_to_chinese(fen, best_move)
    prompt = f"""你是象棋教练。分析一步失误并给出简短的中文解释（2-3句）。

走这步之前的局面（棋盘图）：
{board}

走方：{side}
实际走法：{played_zh}（{move_played}）
最优走法：{best_zh}（{best_move}）
失分：约{score_drop_cp / 100:.1f}个子的优势

请严格依据上面的棋盘图作答，不要臆测图上不存在的棋子。解释：
为什么实际走法是失误，最优走法的关键思路是什么。
不要复述坐标，用象棋术语描述（如"进车""马后炮"等）。"""
    return _chat(prompt, max_tokens=200, timeout=30,
                 feature="explain_mistake", user_id=user_id, ref=ref)
