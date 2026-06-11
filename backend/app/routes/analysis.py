"""棋局分析路由。"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import credits
from ..auth import current_user, current_user_id
from ..deps import get_db
from ..ratelimit import limiter
from ..engine import get_shared_engine
from ..llm import explain_mistake, summarize_game
from ..models import Game, GameAnalysis, Puzzle, User
from ..play_engine import builtin_evaluate, game_status
from ..settings import get_deepseek_config
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/games", tags=["analysis"])

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

# 杀棋折算的等效 centipawn 基准；越快的杀分值越高。
MATE_CP = 30000

# 失误判定阈值（按象棋子力标定：车=900、炮/马≈450、过河兵≈180、兵≈100）
BLUNDER_DROP = 300   # 漏算（丢一子或被反杀级别）
MISTAKE_DROP = 100   # 不准（丢一兵或显著让分）


def _mate_to_cp(mate: int) -> int:
    """将 score mate（几步杀）折算成等效 centipawn，便于与 cp 统一比较。"""
    return (MATE_CP - abs(mate)) * (1 if mate > 0 else -1)


def _flip_score(score_cp: int | None) -> int | None:
    """将评分从对方视角转换（取负值）。"""
    if score_cp is None:
        return None
    return -score_cp


class _Eval:
    """统一封装一个局面的评估：best_move、存档用 cp/mate、比较用 unified cp、pv。"""

    __slots__ = ("best_move", "score_cp", "score_mate", "unified", "pv")

    def __init__(self, best_move, score_cp, score_mate, unified, pv=None):
        self.best_move = best_move
        self.score_cp = score_cp
        self.score_mate = score_mate
        self.unified = unified  # 走子方视角的等效 cp（mate 已折算），用于算 eval_drop
        self.pv = pv            # 主变着法序列（己方/对方交替），用于生成多步题


def _evaluate(fen: str, engine, builtin_depth: int = 3) -> _Eval:
    """评估局面：有 Pikafish 用之，否则回退内置 negamax，保证分析不静默失效。"""
    if engine is not None:
        ev = engine.analyze(fen, depth=15)
        if ev.score_cp is not None:
            return _Eval(ev.best_move, ev.score_cp, None, ev.score_cp, ev.pv)
        if ev.score_mate is not None:
            return _Eval(ev.best_move, None, ev.score_mate, _mate_to_cp(ev.score_mate), ev.pv)
        return _Eval(ev.best_move, None, None, None, ev.pv)

    # 内置兜底：negamax 返回走子方视角 cp，极大值代表搜索内找到强制杀
    mv, cp = builtin_evaluate(fen, depth=builtin_depth)
    cp = max(-MATE_CP, min(MATE_CP, cp))
    return _Eval(mv, cp, None, cp, None)


def _trim_pv(fen: str, pv, max_plies: int = 7) -> list[str]:
    """从 fen 起回放主变，截取一段合法着法作为多步题正解。

    遇到将死即止；以“玩家着法”收尾（奇数长度），便于训练器逐步出题。
    """
    out: list[str] = []
    cur = fen
    for mv in (pv or [])[:max_plies]:
        try:
            nxt = apply_move(cur, mv)
        except Exception:
            break
        out.append(mv)
        cur = nxt
        if game_status(cur) == "checkmate":
            break
    if len(out) % 2 == 0 and out:  # 末尾是对方应着则去掉，保证以己方着收尾
        out = out[:-1]
    return out


def _run_analysis(game_id: int, owner: str = "default") -> None:
    """后台分析函数：逐步分析棋局并写入 game_analysis 表。

    owner 为棋局归属用户，用于把实战漏着自动生成的练习题归为其私有题。
    """
    from ..models import SessionLocal  # 避免循环导入

    db = SessionLocal()
    try:
        game = db.get(Game, game_id)
        if not game:
            return

        move_list = game.moves.split() if game.moves.strip() else []
        if not move_list:
            return

        engine = get_shared_engine()
        if engine is not None:
            engine.new_game()  # 每局开头清一次置换表即可，不在每个局面重复

        # 构建各局面 FEN
        fens: list[str] = [INITIAL_FEN]
        fen = INITIAL_FEN
        for move in move_list:
            try:
                fen = apply_move(fen, move)
            except Exception:
                fen = fens[-1]  # 如果走法非法，保持上一局面
            fens.append(fen)

        # 删除旧分析记录（upsert 实现：先删后插）
        db.query(GameAnalysis).filter(GameAnalysis.game_id == game_id).delete()
        db.commit()

        llm_active = get_deepseek_config(db).active  # 整局一次性判定，避免逐手查配置

        for i, move in enumerate(move_list):
            fen_before = fens[i]
            fen_after = fens[i + 1]

            # 判断走方（0-based 偶数=红方先手）
            side = "红方" if i % 2 == 0 else "黑方"

            best_move: str | None = None
            best_pv: list[str] | None = None
            score_cp_before: int | None = None
            score_mate_before: int | None = None
            eval_drop = 0

            try:
                # 分析走这步之前的局面，得到最优着和评分
                eval_before = _evaluate(fen_before, engine)
                best_move = eval_before.best_move or move
                best_pv = eval_before.pv
                score_cp_before = eval_before.score_cp
                score_mate_before = eval_before.score_mate

                # 分析实际走法后的局面（对方视角），取负得当前方的评价
                eval_after = _evaluate(fen_after, engine)
                played_eval_current = _flip_score(eval_after.unified)

                # eval_drop = 最优评分 - 实际走法评分（mate 已折算成 cp 参与计算）
                if eval_before.unified is not None and played_eval_current is not None:
                    eval_drop = eval_before.unified - played_eval_current
            except Exception:
                pass

            is_blunder = eval_drop > BLUNDER_DROP
            is_mistake = eval_drop > MISTAKE_DROP

            explanation = ""
            # 失误讲解由大模型生成，逐处消耗积分；扣不动则只保留引擎数据（不再调用 LLM）。
            if (
                (is_blunder or is_mistake)
                and best_move
                and best_move != move
                and llm_active
                and credits.try_spend(db, owner, "mistake_explain", f"game:{game_id}")
            ):
                explanation = explain_mistake(
                    fen=fen_before,
                    move_played=move,
                    best_move=best_move,
                    score_drop_cp=eval_drop,
                    move_number=i + 1,
                    side=side,
                )
                if not explanation:
                    credits.refund(db, owner, "mistake_explain", f"game:{game_id}")

            # 对大漏着创建练习题
            puzzle_id: int | None = None
            if is_blunder and best_move and best_move != move:
                # 判断 FEN 中走方
                fen_parts = fen_before.split()
                side_to_move = fen_parts[1] if len(fen_parts) > 1 else "w"
                # 用引擎主变生成多步正解（己方/对方交替），取不到则退化为单手
                trimmed = _trim_pv(fen_before, best_pv)
                solution = ",".join(trimmed) if len(trimmed) >= 1 else best_move
                puzzle = Puzzle(
                    fen=fen_before,
                    solution=solution,
                    side_to_move=side_to_move,
                    category="实战漏算",
                    source=f"game_{game_id}",
                    user_id=owner,  # 实战漏着题归棋局所有者私有
                )
                db.add(puzzle)
                db.flush()  # 获取 puzzle.id
                puzzle_id = puzzle.id

            record = GameAnalysis(
                game_id=game_id,
                move_index=i,
                fen_before=fen_before,
                move_played=move,
                best_move=best_move or "",
                score_cp=score_cp_before,
                score_mate=score_mate_before,
                eval_drop=eval_drop,
                is_blunder=is_blunder,
                is_mistake=is_mistake,
                explanation=explanation,
                puzzle_id=puzzle_id,
            )
            db.add(record)
            db.commit()  # 逐步提交，使前端可轮询出进度

        # 全部走法分析完成后，汇总失误生成 LLM 综合复盘报告
        _generate_report(db, game_id, owner)

        # 据本局新数据（失误画像/新生成的漏算题）刷新 AI 教练训练计划
        try:
            from ..coach import generate_plan

            generate_plan(db, owner, trigger=f"game:{game_id}")
        except Exception:
            db.rollback()  # 计划生成失败不影响已落库的分析结果

        # 共享引擎进程跨棋局复用，分析结束不再 close()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _generate_report(db, game_id: int, owner: str = "default") -> None:
    """据逐步分析结果调用 LLM 生成整局综合复盘报告，写入 game.report。

    报告由大模型生成，消耗积分；未启用大模型或积分不足时跳过（不影响逐步分析结果）。
    """
    if not get_deepseek_config(db).active:
        return
    game = db.get(Game, game_id)
    if not game:
        return
    if not credits.try_spend(db, owner, "game_report", f"game:{game_id}"):
        return
    records = (
        db.query(GameAnalysis)
        .filter(GameAnalysis.game_id == game_id)
        .order_by(GameAnalysis.move_index)
        .all()
    )
    total = len(records)
    mistakes = [
        {
            "move_number": r.move_index + 1,
            "side": "红方" if r.move_index % 2 == 0 else "黑方",
            "eval_drop_cp": r.eval_drop,
            "severity": "严重失误" if r.is_blunder else "失误",
            "explanation": r.explanation,
        }
        for r in records
        if r.is_blunder or r.is_mistake
    ]

    report = summarize_game(
        result=game.result or "未知",
        human_side="",  # 复盘以客观视角，不强绑红/黑
        total_moves=total,
        mistakes=mistakes,
    )
    if report:
        game.report = report
        db.commit()
    else:
        credits.refund(db, owner, "game_report", f"game:{game_id}")


@router.post("/{game_id}/analyze")
@limiter.limit("10/minute")
def analyze_game(
    request: Request,
    game_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """触发棋局分析（后台执行）。

    需登录。引擎逐步分析始终进行；大模型点评（失误讲解 / 复盘报告 / 教练计划）按积分
    余额逐项消耗，余额耗尽则自动降级为纯引擎数据，不会无上限地刷大模型。
    """
    game = db.get(Game, game_id)
    if not game or game.user_id != user.username:
        raise HTTPException(status_code=404, detail="棋局不存在")

    background_tasks.add_task(_run_analysis, game_id, user.username)
    return {"status": "analyzing", "game_id": game_id}


@router.get("/{game_id}/analysis")
def get_analysis(
    game_id: int,
    db: Session = Depends(get_db),
    user: str = Depends(current_user_id),
):
    """获取棋局分析结果。"""
    game = db.get(Game, game_id)
    if not game or game.user_id != user:
        raise HTTPException(status_code=404, detail="棋局不存在")

    records = (
        db.query(GameAnalysis)
        .filter(GameAnalysis.game_id == game_id)
        .order_by(GameAnalysis.move_index)
        .all()
    )

    total = len(game.moves.split()) if game.moves and game.moves.strip() else 0
    analyzed = len(records)

    if not records:
        return {"status": "not_analyzed", "moves": [], "total": total, "analyzed": 0, "report": ""}

    moves = [
        {
            "id": r.id,
            "game_id": r.game_id,
            "move_index": r.move_index,
            "fen_before": r.fen_before,
            "move_played": r.move_played,
            "best_move": r.best_move,
            "score_cp": r.score_cp,
            "score_mate": r.score_mate,
            "eval_drop": r.eval_drop,
            "is_blunder": r.is_blunder,
            "is_mistake": r.is_mistake,
            "explanation": r.explanation,
            "puzzle_id": r.puzzle_id,
        }
        for r in records
    ]

    blunder_count = sum(1 for r in records if r.is_blunder)
    mistake_count = sum(1 for r in records if r.is_mistake and not r.is_blunder)

    done = bool(total and analyzed >= total)
    return {
        "status": "done" if done else "analyzing",
        "moves": moves,
        "blunder_count": blunder_count,
        "mistake_count": mistake_count,
        "total": total,
        "analyzed": analyzed,
        # 报告在逐步分析全部完成后才生成，故仅 done 时返回
        "report": (game.report or "") if done else "",
        # 供前端区分「无报告」是因 AI 未启用，还是本局无可点评内容
        "llm_enabled": get_deepseek_config(db).active,
    }
