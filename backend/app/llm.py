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
