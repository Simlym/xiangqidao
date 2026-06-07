"""棋局分析路由。"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..engine import get_engine
from ..llm import explain_mistake
from ..models import Game, GameAnalysis, Puzzle
from ..xiangqi_utils import apply_move

router = APIRouter(prefix="/api/games", tags=["analysis"])

INITIAL_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


def _flip_score(score_cp: int | None) -> int | None:
    """将评分从对方视角转换（取负值）。"""
    if score_cp is None:
        return None
    return -score_cp


def _run_analysis(game_id: int) -> None:
    """后台分析函数：逐步分析棋局并写入 game_analysis 表。"""
    from ..models import SessionLocal  # 避免循环导入

    db = SessionLocal()
    try:
        game = db.get(Game, game_id)
        if not game:
            return

        move_list = game.moves.split() if game.moves.strip() else []
        if not move_list:
            return

        engine = get_engine()

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

        for i, move in enumerate(move_list):
            fen_before = fens[i]
            fen_after = fens[i + 1]

            # 判断走方（0-based 偶数=红方先手）
            side = "红方" if i % 2 == 0 else "黑方"

            best_move: str | None = None
            score_cp_before: int | None = None
            score_mate_before: int | None = None
            eval_drop = 0

            if engine is not None:
                try:
                    # 分析走这步之前的局面，得到引擎最优着和评分
                    eval_before = engine.analyze(fen_before, depth=15)
                    best_move = eval_before.best_move or move
                    score_cp_before = eval_before.score_cp
                    score_mate_before = eval_before.score_mate

                    # 分析实际走法后的局面（从对方视角），取负得当前方的评价
                    eval_after = engine.analyze(fen_after, depth=15)
                    played_eval_current = _flip_score(eval_after.score_cp)

                    # eval_drop = 引擎最优评分 - 实际走法评分
                    if score_cp_before is not None and played_eval_current is not None:
                        eval_drop = score_cp_before - played_eval_current
                    elif score_cp_before is not None:
                        eval_drop = 0
                except Exception:
                    pass

            is_blunder = eval_drop > 200
            is_mistake = eval_drop > 80

            explanation = ""
            if engine is not None and (is_blunder or is_mistake) and best_move and best_move != move:
                explanation = explain_mistake(
                    fen=fen_before,
                    move_played=move,
                    best_move=best_move,
                    score_drop_cp=eval_drop,
                    move_number=i + 1,
                    side=side,
                )

            # 对大漏着创建练习题
            puzzle_id: int | None = None
            if engine is not None and is_blunder and best_move and best_move != move:
                # 判断 FEN 中走方
                fen_parts = fen_before.split()
                side_to_move = fen_parts[1] if len(fen_parts) > 1 else "w"
                puzzle = Puzzle(
                    fen=fen_before,
                    solution=best_move,
                    side_to_move=side_to_move,
                    category="实战漏算",
                    source=f"game_{game_id}",
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

        db.commit()

        if engine is not None:
            try:
                engine.close()
            except Exception:
                pass
    except Exception:
        db.rollback()
    finally:
        db.close()


@router.post("/{game_id}/analyze")
def analyze_game(game_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """触发棋局分析（后台执行）。"""
    game = db.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="棋局不存在")

    background_tasks.add_task(_run_analysis, game_id)
    return {"status": "analyzing", "game_id": game_id}


@router.get("/{game_id}/analysis")
def get_analysis(game_id: int, db: Session = Depends(get_db)):
    """获取棋局分析结果。"""
    game = db.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="棋局不存在")

    records = (
        db.query(GameAnalysis)
        .filter(GameAnalysis.game_id == game_id)
        .order_by(GameAnalysis.move_index)
        .all()
    )

    if not records:
        return {"status": "not_analyzed", "moves": []}

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

    return {
        "status": "done",
        "moves": moves,
        "blunder_count": blunder_count,
        "mistake_count": mistake_count,
    }
