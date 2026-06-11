"""DeepSeek Chat API 调用。"""
import httpx

from .settings import get_deepseek_config

DEEPSEEK_BASE = "https://api.deepseek.com/v1"


def _chat(prompt: str, max_tokens: int = 200, timeout: int = 15) -> str:
    """调用 DeepSeek Chat，未启用/未配置 key 或失败时返回空字符串。"""
    cfg = get_deepseek_config()
    if not cfg.active:
        return ""
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                f"{DEEPSEEK_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {cfg.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": cfg.model,
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return ""


def summarize_game(
    result: str,                 # 对局结果，如 "红胜"/"黑胜"/"和棋"
    human_side: str,             # 复盘视角："红方"/"黑方"，空串表示不指定
    total_moves: int,
    mistakes: list[dict],        # [{move_number, side, eval_drop_cp, severity, explanation}]
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
    return _chat(prompt, max_tokens=400, timeout=30)


def explain_puzzle(
    fen: str,
    solution: list[str],   # 正解着法序列（UCI，己方/对方交替）
    category: str,         # 战术名目，如 "卧槽马"
    side: str,             # "红方" / "黑方"
) -> str:
    """讲解一道战术题的解题思路（中文）。未配置 key 时返回空串。"""
    seq = " → ".join(solution)
    prompt = f"""你是象棋教练。请讲解下面这道战术题的解题思路（中文，3-5句）。

局面FEN：{fen}
轮到{side}走子，战术主题：{category or "未分类"}
正解着法序列（UCI坐标制，如h2e2表示从h2到e2，己方与对方应着交替）：{seq}

请说明：① 这个杀法/战术的核心思路与子力配合；② 为什么对方无法解拆；③ 实战中识别此类机会的要点。
不要复述坐标，用象棋术语描述（如"卧槽马""双车错""闷宫"等），简洁专业。"""
    return _chat(prompt, max_tokens=400, timeout=30)


def coach_move(
    fen: str,
    move: str,     # 推荐着法 UCI
    side: str,     # "红方" / "黑方"
) -> str:
    """点评一步推荐着法好在哪里（中文，2-3句）。未配置 key 时返回空串。"""
    prompt = f"""你是象棋教练。引擎推荐了一步棋，请简短解释这步棋的意图（中文，2-3句）。

局面FEN：{fen}
轮到{side}走子，推荐着法：{move}（UCI坐标制，如h2e2表示从h2到e2）

请说明这步棋的战术/战略意图（如抢先手、控线、兑子简化、做杀等）。
不要复述坐标，用象棋术语描述。"""
    return _chat(prompt, max_tokens=200, timeout=30)


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
    return _chat(prompt, max_tokens=550, timeout=30)


def explain_mistake(
    fen: str,
    move_played: str,      # UCI，如 "h2e2"
    best_move: str,        # UCI
    score_drop_cp: int,    # 失分（正值=失分）
    move_number: int,
    side: str,             # "红方" / "黑方"
) -> str:
    """调用 DeepSeek 解释这步失误，返回中文字符串。未配置 key 时返回空字符串。"""
    prompt = f"""你是象棋教练。分析一步失误并给出简短的中文解释（2-3句）。

局面FEN：{fen}
走方：{side}
实际走法：{move_played}（UCI坐标制，如h2e2表示从h2到e2）
最优走法：{best_move}
失分：约{score_drop_cp // 100:.1f}个子的优势

请解释：为什么实际走法是失误，最优走法的关键思路是什么。
不要复述坐标，用象棋术语描述（如"进车""马后炮"等）。"""
    return _chat(prompt, max_tokens=200)
