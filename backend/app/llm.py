"""DeepSeek Chat API 调用。"""
import os
import httpx

DEEPSEEK_BASE = "https://api.deepseek.com/v1"


def explain_mistake(
    fen: str,
    move_played: str,      # UCI，如 "h2e2"
    best_move: str,        # UCI
    score_drop_cp: int,    # 失分（正值=失分）
    move_number: int,
    side: str,             # "红方" / "黑方"
) -> str:
    """调用 DeepSeek 解释这步失误，返回中文字符串。未配置 key 时返回空字符串。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        return ""

    prompt = f"""你是象棋教练。分析一步失误并给出简短的中文解释（2-3句）。

局面FEN：{fen}
走方：{side}
实际走法：{move_played}（UCI坐标制，如h2e2表示从h2到e2）
最优走法：{best_move}
失分：约{score_drop_cp // 100:.1f}个子的优势

请解释：为什么实际走法是失误，最优走法的关键思路是什么。
不要复述坐标，用象棋术语描述（如"进车""马后炮"等）。"""

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                f"{DEEPSEEK_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "deepseek-chat",
                    "max_tokens": 200,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception:
        return ""
