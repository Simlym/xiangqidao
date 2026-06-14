import React from "react";
import ReactMarkdown from "react-markdown";
import Board from "./Board";
import { uciToChinese } from "./xiangqi";
import { getGames, importGame, getGamePositions, deleteGame, analyzeGame, getAnalysis } from "./api";

const RESULT_LABELS = {
  "1-0": { text: "红胜", color: "#c0392b" },
  "0-1": { text: "黑胜", color: "#222" },
  "1/2-1/2": { text: "和棋", color: "#888" },
  "": { text: "未知", color: "#aaa" },
};

function resultLabel(result) {
  return RESULT_LABELS[result] || { text: result || "未知", color: "#aaa" };
}

const EMPTY_FORM = {
  moves: "",
  red_player: "",
  black_player: "",
  date: "",
  result: "1-0",
  opening: "",
};

function getMoveQuality(moveData) {
  if (!moveData) return null;
  if (moveData.is_blunder) return "blunder";
  if (moveData.is_mistake) return "mistake";
  if (moveData.move_played !== moveData.best_move) return "inaccuracy";
  return "best";
}

// 仿天天象棋的五级着法品质，按 eval_drop（走子方视角失分，单位厘兵）分档。
// 与后端阈值对齐：>300 严重失误(差)、>100 失误(中)；其余按失分细分优/良；走最优=最佳。
// 返回 { key, label, symbol } —— symbol 为 true 时 label 是符号（最佳用 ✦）。
function getMoveGrade(moveData) {
  if (!moveData) return null;
  const drop = moveData.eval_drop != null ? moveData.eval_drop : 0;
  if (moveData.move_played === moveData.best_move || drop <= 10) {
    return { key: "best", label: "✦", symbol: true, title: "最佳" };
  }
  if (drop > 300) return { key: "blunder", label: "差", title: "严重失误" };
  if (drop > 100) return { key: "mistake", label: "中", title: "失误" };
  if (drop > 50) return { key: "good", label: "良", title: "尚可" };
  return { key: "excellent", label: "优", title: "不错" };
}

// 把存档评分换算成「红方视角」的厘兵（centipawn）值：红优为正、黑优为负。
// 存档的 score_cp/score_mate 为「走子方视角」（fen_before 的轮走方），黑方走子需取负。
// 杀棋折算为一个较大的有界数值，便于在曲线里和普通评分一起比较。
const MATE_CP = 1500;
function redPerspectiveCp(moveData) {
  if (!moveData) return null;
  const sign = moveData.move_index % 2 === 0 ? 1 : -1;
  if (moveData.score_mate != null && moveData.score_mate !== 0) {
    const m = moveData.score_mate;
    // 杀棋步数越少越接近极值；不同步数留出差异但都封顶在 MATE_CP 内
    const mag = MATE_CP - Math.min(Math.abs(m) - 1, 10) * 20;
    return (m > 0 ? mag : -mag) * sign;
  }
  if (moveData.score_cp != null) return moveData.score_cp * sign;
  return null;
}

// 把引擎评分格式化为红方视角的展示字符串。
function formatMoveScore(moveData) {
  if (!moveData) return null;
  const redPerspective = moveData.move_index % 2 === 0 ? 1 : -1;
  if (moveData.score_mate != null && moveData.score_mate !== 0) {
    const m = moveData.score_mate * redPerspective;
    return { text: `${m > 0 ? "+" : "-"}杀${Math.abs(m)}`, positive: m > 0, mate: true };
  }
  if (moveData.score_cp != null) {
    const cp = (moveData.score_cp * redPerspective) / 100;
    const sign = cp > 0 ? "+" : cp < 0 ? "−" : "";
    return { text: `${sign}${Math.abs(cp).toFixed(1)}`, positive: cp > 0, mate: false };
  }
  return null;
}

export default function Games({ onNavigateToTrain, initialGameId, onInitialGameConsumed, user, onCreditsChanged, onRequireLogin }) {
  const [games, setGames] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState(null);
  const [positions, setPositions] = React.useState(null);
  const [posLoading, setPosLoading] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  // 右侧面板 tab：moves 着法列表 | curve 局势图 | blunders 失误分析 | report 报告
  const [reviewTab, setReviewTab] = React.useState("moves");
  const [showImport, setShowImport] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const moveListRef = React.useRef(null);

  // Analysis state
  // idle: 未分析 | analyzing: 分析进行中 | partial: 有历史分析但未完成（可继续） | done: 已完成
  const [analyzeStatus, setAnalyzeStatus] = React.useState("idle");
  const [analysisData, setAnalysisData] = React.useState(null); // null or {moves, blunder_count, mistake_count}
  const [progress, setProgress] = React.useState({ analyzed: 0, total: 0 });
  const pollRef = React.useRef(null);
  const pendingAutoAnalyze = React.useRef(null); // 来自对弈跳转、需自动拉取分析的棋局 id

  // 轮询分析进度，完成后落地结果（不重复触发分析）
  const startPolling = React.useCallback((id) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setAnalyzeStatus("analyzing");
    pollRef.current = setInterval(async () => {
      try {
        const result = await getAnalysis(id);
        if (result.total != null) {
          setProgress({ analyzed: result.analyzed || 0, total: result.total });
        }
        if (result.status === "done") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setAnalyzeStatus("done");
          setAnalysisData(result);
          onCreditsChanged?.(); // 分析期间的大模型点评已消耗积分，刷新余额
        }
      } catch {
        // keep polling
      }
    }, 1000);
  }, [onCreditsChanged]);

  // Load games list
  const loadGames = React.useCallback(() => {
    setLoading(true);
    getGames(50, 0)
      .then((data) => {
        setGames(Array.isArray(data) ? data : data.games || []);
      })
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    loadGames();
  }, [loadGames]);

  // 从对弈结束「一键复盘」跳转而来：自动选中该局并拉取（已在后台进行的）分析
  React.useEffect(() => {
    if (initialGameId) {
      pendingAutoAnalyze.current = initialGameId;
      setSelectedId(initialGameId);
      loadGames(); // 刷新列表以纳入刚结束的对局
      onInitialGameConsumed?.();
    }
  }, [initialGameId, loadGames, onInitialGameConsumed]);

  // Load positions when a game is selected
  React.useEffect(() => {
    if (!selectedId) {
      setPositions(null);
      setStepIndex(0);
      return;
    }
    setPosLoading(true);
    getGamePositions(selectedId)
      .then((data) => {
        setPositions(data);
        setStepIndex(0);
      })
      .catch(() => setPositions(null))
      .finally(() => setPosLoading(false));
  }, [selectedId]);

  // 切换棋局：重置状态后检查数据库里已保存的分析，有则直接加载，避免重复分析
  React.useEffect(() => {
    setAnalyzeStatus("idle");
    setAnalysisData(null);
    setReviewTab("moves");
    setProgress({ analyzed: 0, total: 0 });
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!selectedId) return;
    // 若该局是从对弈跳转而来，分析已在后台进行，直接轮询进度
    if (pendingAutoAnalyze.current === selectedId) {
      pendingAutoAnalyze.current = null;
      startPolling(selectedId);
      return;
    }
    let alive = true;
    getAnalysis(selectedId)
      .then((result) => {
        if (!alive) return;
        if (result.status === "done") {
          setAnalyzeStatus("done");
          setAnalysisData(result);
          setProgress({ analyzed: result.analyzed || 0, total: result.total || 0 });
        } else if (result.analyzed > 0) {
          // 有部分历史分析（可能中途中断）：先展示已有结果，按钮变为「继续分析」
          setAnalyzeStatus("partial");
          setAnalysisData(result);
          setProgress({ analyzed: result.analyzed || 0, total: result.total || 0 });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedId, startPolling]);

  // Cleanup polling on unmount
  React.useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Keyboard navigation
  React.useEffect(() => {
    function onKey(e) {
      if (!positions) return;
      const total = positions.positions ? positions.positions.length : 0;
      if (e.key === "ArrowLeft") {
        setStepIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setStepIndex((i) => Math.min(total - 1, i + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [positions]);

  // Scroll current move into view
  React.useEffect(() => {
    if (moveListRef.current) {
      const active = moveListRef.current.querySelector(".move-item.active");
      if (active) active.scrollIntoView({ block: "nearest" });
    }
  }, [stepIndex]);

  const positionsList = positions?.positions || [];
  // 后端 moves 字段是空格分隔字符串；着法直接取自每一步局面（move_index≥1 带 UCI），与 fen 天然对齐
  const movesList = positionsList.slice(1).map((p) => p.move);
  const currentPos = positionsList[stepIndex] || null;
  const currentFen = currentPos?.fen || "";
  // lastMove is the move that led to current position
  const lastMove = stepIndex > 0 ? movesList[stepIndex - 1] : null;

  // 把 UCI 着法转成中文棋谱（用走子前的局面 positionsList[i] 解析）
  const moveTexts = React.useMemo(
    () =>
      positionsList
        .slice(1)
        .map((p, i) =>
          positionsList[i]?.fen ? uciToChinese(positionsList[i].fen, p.move) : p.move
        ),
    [positionsList]
  );

  // Group moves into rounds (pair of moves)
  const rounds = [];
  for (let i = 0; i < movesList.length; i += 2) {
    rounds.push({ round: Math.floor(i / 2) + 1, red: i, black: i + 1 });
  }

  // Build analysis map: move_index -> move data
  const analysisMap = React.useMemo(() => {
    if (!analysisData || !analysisData.moves) return {};
    const map = {};
    for (const m of analysisData.moves) {
      map[m.move_index] = m;
    }
    return map;
  }, [analysisData]);

  // 评分曲线数据：每一步的红方视角厘兵值，含失误标记，供走势图与失误列表共用
  const evalPoints = React.useMemo(() => {
    if (!analysisData?.moves) return [];
    return analysisData.moves
      .map((m) => {
        const cp = redPerspectiveCp(m);
        if (cp == null) return null;
        return {
          moveIndex: m.move_index, // 0-based 着法序号
          step: m.move_index + 1, // 对应 stepIndex（局面下标）
          cp,
          quality: getMoveQuality(m),
          mate: m.score_mate != null && m.score_mate !== 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.moveIndex - b.moveIndex);
  }, [analysisData]);

  // 失误列表（严重失误 + 失误），按步序排列，可点击跳转
  const blunderList = React.useMemo(() => {
    if (!analysisData?.moves) return [];
    return analysisData.moves
      .filter((m) => m.is_blunder || m.is_mistake)
      .map((m) => ({
        step: m.move_index + 1,
        moveIndex: m.move_index,
        isBlunder: m.is_blunder,
        side: m.move_index % 2 === 0 ? "红" : "黑",
        text: positionsList[m.move_index]?.fen
          ? uciToChinese(positionsList[m.move_index].fen, m.move_played)
          : m.move_played,
        evalDrop: m.eval_drop != null ? m.eval_drop / 100 : null,
      }))
      .sort((a, b) => a.moveIndex - b.moveIndex);
  }, [analysisData, positionsList]);

  // Current analysis detail: stepIndex corresponds to move at index stepIndex-1
  const currentMoveAnalysis = stepIndex > 0 ? analysisMap[stepIndex - 1] : null;

  // 当前局面所对应着法的品质角标（贴在刚走的棋子=move_played 落点上）
  const currentGrade = React.useMemo(() => {
    if (!currentMoveAnalysis || !lastMove) return null;
    const g = getMoveGrade(currentMoveAnalysis);
    if (!g) return null;
    return { ...g, square: lastMove.slice(2, 4) };
  }, [currentMoveAnalysis, lastMove]);

  // 非最佳着法时，画出引擎推荐着法（best_move）的箭头
  const recommendArrow =
    currentMoveAnalysis &&
    currentMoveAnalysis.best_move &&
    currentMoveAnalysis.best_move !== currentMoveAnalysis.move_played
      ? currentMoveAnalysis.best_move
      : null;

  function handleSelectGame(id) {
    setSelectedId(id === selectedId ? null : id);
  }

  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleImport(e) {
    e.preventDefault();
    if (!form.moves.trim()) {
      setImportError("着法序列不能为空");
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      await importGame({
        moves: form.moves.trim(),
        red_player: form.red_player,
        black_player: form.black_player,
        date: form.date,
        result: form.result,
        opening: form.opening,
      });
      setForm(EMPTY_FORM);
      setShowImport(false);
      loadGames();
    } catch {
      setImportError("导入失败，请检查格式");
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!window.confirm("确认删除这局棋局？")) return;
    await deleteGame(id);
    if (selectedId === id) setSelectedId(null);
    loadGames();
  }

  async function handleAnalyze() {
    if (!selectedId || analyzeStatus === "analyzing") return;
    if (!user) {
      onRequireLogin?.();
      return;
    }
    setProgress({ analyzed: 0, total: 0 });
    try {
      await analyzeGame(selectedId);
    } catch (e) {
      if (e.status === 401) {
        onRequireLogin?.();
        return;
      }
      // 其它错误：仍尝试轮询（分析可能已在进行）
    }
    onCreditsChanged?.(); // 分析会按余额消耗大模型点评积分
    startPolling(selectedId);
  }

  return (
    <div className="games-layout">
      {/* Left: game list */}
      <div className="games-list-panel">
        <div className="games-list-header">
          <span className="games-list-title">棋局列表</span>
          {loading && <span className="muted"> 加载中…</span>}
        </div>

        <div className="games-list-scroll">
          {games.length === 0 && !loading && (
            <div className="muted" style={{ padding: "12px" }}>
              暂无棋局，请导入
            </div>
          )}
          {games.map((g) => {
            const rl = resultLabel(g.result);
            const isSelected = g.id === selectedId;
            return (
              <div
                key={g.id}
                className={"game-item" + (isSelected ? " selected" : "")}
                onClick={() => handleSelectGame(g.id)}
              >
                <div className="game-item-top">
                  <span
                    className="game-result-tag"
                    style={{ color: rl.color, borderColor: rl.color }}
                  >
                    {rl.text}
                  </span>
                  <div className="game-item-players">
                    <span className="game-red">{g.red_player || "红方"}</span>
                    <span className="game-vs">vs</span>
                    <span className="game-black">{g.black_player || "黑方"}</span>
                  </div>
                  <button
                    className="game-delete-btn"
                    title="删除"
                    onClick={(e) => handleDelete(e, g.id)}
                  >
                    ×
                  </button>
                </div>
                <div className="game-item-meta">
                  {g.opening && <span className="game-opening">{g.opening}</span>}
                  {g.move_count > 0 && (
                    <span className="game-moves muted">{g.move_count} 手</span>
                  )}
                  {g.played_on && <span className="game-date muted">{g.played_on}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Import button */}
        <div className="games-list-footer">
          <button
            className="btn-import"
            onClick={() => setShowImport((v) => !v)}
          >
            {showImport ? "▲ 收起" : "＋ 导入棋局"}
          </button>
        </div>

        {/* Import form */}
        {showImport && (
          <form className="import-form" onSubmit={handleImport}>
            <label className="import-label">
              着法序列（UCI格式，必填）
              <textarea
                name="moves"
                value={form.moves}
                onChange={handleFormChange}
                placeholder="h2e2 h9g7 e2e6 ..."
                rows={3}
                className="import-textarea"
              />
            </label>
            <div className="import-row">
              <label className="import-label half">
                红方
                <input
                  name="red_player"
                  value={form.red_player}
                  onChange={handleFormChange}
                  className="import-input"
                  placeholder="红方姓名"
                />
              </label>
              <label className="import-label half">
                黑方
                <input
                  name="black_player"
                  value={form.black_player}
                  onChange={handleFormChange}
                  className="import-input"
                  placeholder="黑方姓名"
                />
              </label>
            </div>
            <div className="import-row">
              <label className="import-label half">
                日期
                <input
                  name="date"
                  type="date"
                  value={form.date}
                  onChange={handleFormChange}
                  className="import-input"
                />
              </label>
              <label className="import-label half">
                结果
                <select
                  name="result"
                  value={form.result}
                  onChange={handleFormChange}
                  className="import-input"
                >
                  <option value="1-0">红胜</option>
                  <option value="0-1">黑胜</option>
                  <option value="1/2-1/2">和棋</option>
                </select>
              </label>
            </div>
            <label className="import-label">
              开局名
              <input
                name="opening"
                value={form.opening}
                onChange={handleFormChange}
                className="import-input"
                placeholder="如：中炮对屏风马"
              />
            </label>
            {importError && (
              <div className="import-error">{importError}</div>
            )}
            <button
              type="submit"
              className="btn-import-submit"
              disabled={importing}
            >
              {importing ? "导入中…" : "确认导入"}
            </button>
          </form>
        )}
      </div>

      {/* Right: review area */}
      <div className="games-review-panel">
        {!selectedId ? (
          <div className="games-empty">
            <span>请从左侧选择一局棋局</span>
          </div>
        ) : posLoading ? (
          <div className="games-empty">
            <span className="muted">加载中…</span>
          </div>
        ) : !positions ? (
          <div className="games-empty">
            <span className="muted">加载失败</span>
          </div>
        ) : (
          <div className="review-content">
            {/* 左：棋盘常驻 */}
            <div className="review-board-wrap">
              {currentFen ? (
                <Board
                  fen={currentFen}
                  onMove={() => {}}
                  lastMove={lastMove}
                  arrowMove={recommendArrow}
                  gradeBadge={currentGrade}
                  disabled={true}
                />
              ) : (
                <div className="muted">无棋盘数据</div>
              )}
              {/* 导航 + 分析同一行：左导航占主，右侧分析块（按钮 + 状态上下叠放） */}
              <div className="review-nav btn-row">
                <button
                  className="btn-retry"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  disabled={stepIndex === 0}
                >
                  ◀ 上一步
                </button>
                <span className="review-step-counter muted">
                  {stepIndex}/{positionsList.length - 1}
                </span>
                <button
                  className="btn-retry"
                  onClick={() =>
                    setStepIndex((i) =>
                      Math.min(positionsList.length - 1, i + 1)
                    )
                  }
                  disabled={stepIndex === positionsList.length - 1}
                >
                  下一步 ▶
                </button>

                <span className="review-nav-spacer" />

                {/* 分析控件：按状态分级——已分析降为低调小链接，未分析才用醒目主按钮 */}
                {analyzeStatus === "done" ? (
                  <button className="btn-reanalyze" onClick={handleAnalyze} title="重新分析此局">
                    ↻ 重新分析
                  </button>
                ) : analyzeStatus === "analyzing" ? (
                  <div className="analyze-progress">
                    <div className="analyze-progress-track">
                      <div
                        className="analyze-progress-fill"
                        style={{
                          width: progress.total
                            ? `${Math.round((progress.analyzed / progress.total) * 100)}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <span className="analyze-progress-text muted">
                      {progress.total ? `${progress.analyzed}/${progress.total}` : "准备中…"}
                    </span>
                  </div>
                ) : (
                  <button className="btn-analyze" onClick={handleAnalyze}>
                    {analyzeStatus === "partial" ? "继续分析" : "分析此局"}
                  </button>
                )}
              </div>
            </div>

            {/* 右：tab 切换面板 */}
            <div className="review-side">
              {/* Tab 头 */}
              <div className="review-tabs" role="tablist">
                {[
                  { key: "moves", label: "着法列表" },
                  { key: "curve", label: "局势图" },
                  { key: "blunders", label: "失误分析" },
                  { key: "report", label: "报告" },
                ].map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={reviewTab === t.key}
                    className={"review-tab" + (reviewTab === t.key ? " active" : "")}
                    onClick={() => setReviewTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab 内容 */}
              <div className="review-tab-body">
                {/* 着法列表 */}
                {reviewTab === "moves" && (
                  <div className="review-moves-wrap">
                    <div className="review-moves-head">
                      <span className="move-col-num"></span>
                      <span className="move-col-side red">红方</span>
                      <span className="move-col-side black">黑方</span>
                    </div>
                    <div className="review-moves-list" ref={moveListRef}>
                      {rounds.map(({ round, red, black }) => (
                        <div key={round} className="move-round">
                          <span className="move-round-num">{round}</span>
                          <MoveItem
                            moveIndex={red}
                            moveText={moveTexts[red] || ""}
                            isActive={stepIndex === red + 1}
                            analysisEntry={analysisMap[red]}
                            onClick={() => setStepIndex(red + 1)}
                          />
                          {movesList[black] !== undefined ? (
                            <MoveItem
                              moveIndex={black}
                              moveText={moveTexts[black]}
                              isActive={stepIndex === black + 1}
                              analysisEntry={analysisMap[black]}
                              onClick={() => setStepIndex(black + 1)}
                            />
                          ) : (
                            <span className="move-item move-item-empty" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 局势图 */}
                {reviewTab === "curve" && (
                  (analyzeStatus === "done" || analyzeStatus === "partial") && evalPoints.length > 1 ? (
                    <EvalCurve
                      points={evalPoints}
                      currentStep={stepIndex}
                      onSelect={(step) => setStepIndex(step)}
                    />
                  ) : (
                    <div className="review-tab-empty muted">先「分析此局」即可看到评分走势。</div>
                  )
                )}

                {/* 失误分析 */}
                {reviewTab === "blunders" && (
                  (analyzeStatus === "done" || analyzeStatus === "partial") && analysisData ? (
                    <AnalysisPanel
                      summary={{ blunder_count: analysisData.blunder_count, mistake_count: analysisData.mistake_count }}
                      blunderList={blunderList}
                      moveAnalysis={currentMoveAnalysis}
                      stepIndex={stepIndex}
                      preFen={stepIndex > 0 ? positionsList[stepIndex - 1]?.fen : ""}
                      onSelectStep={(step) => setStepIndex(step)}
                      onNavigateToTrain={onNavigateToTrain}
                    />
                  ) : (
                    <div className="review-tab-empty muted">先「分析此局」即可看到失误统计与逐步讲解。</div>
                  )
                )}

                {/* 报告 */}
                {reviewTab === "report" && (
                  analyzeStatus === "done" && analysisData?.report ? (
                    <div className="analysis-panel report-panel">
                      <div className="review-moves-title">📋 综合复盘报告</div>
                      <div className="report-text markdown-body">
                        <ReactMarkdown>{analysisData.report}</ReactMarkdown>
                      </div>
                    </div>
                  ) : analyzeStatus === "done" && analysisData?.llm_enabled === false ? (
                    <div className="review-tab-empty muted">
                      💡 已完成引擎逐步分析。开启「AI 复盘」后还能获得失误讲解与整局总评（管理员可在后台配置）。
                    </div>
                  ) : analyzeStatus === "partial" ? (
                    <div className="review-tab-empty muted">
                      本局有一次未完成的分析（{progress.analyzed}/{progress.total} 步），
                      点「继续分析」可完成剩余着法后生成总评。
                    </div>
                  ) : (
                    <div className="review-tab-empty muted">先「分析此局」即可生成整局总评。</div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MoveItem({ moveIndex, moveText, isActive, analysisEntry, onClick }) {
  const quality = getMoveQuality(analysisEntry);
  let extraClass = "";
  if (quality === "blunder") extraClass = " move-blunder";
  else if (quality === "mistake") extraClass = " move-mistake";
  else if (quality === "inaccuracy") extraClass = " move-inaccuracy";

  const score = formatMoveScore(analysisEntry);
  const dot =
    quality === "blunder" ? "●" : quality === "mistake" ? "●" : quality === "inaccuracy" ? "●" : "";

  return (
    <span
      className={"move-item" + (isActive ? " active" : "") + extraClass}
      onClick={onClick}
    >
      <span className={"move-flag " + (quality || "")}>{dot}</span>
      <span className="move-item-text">{moveText}</span>
      {score && (
        <span
          className={
            "move-score" +
            (score.mate ? " mate" : "") +
            (score.positive ? " positive" : " negative")
          }
        >
          {score.text}
        </span>
      )}
    </span>
  );
}

// 把红方视角厘兵值映射到 [-1,1]：用 tanh 让小优势（±1~3 子）也明显铺开、大优势平滑饱和，
// 接近天天象棋的优势条手感，避免本局都在 ±1.5 子时曲线被压成一条平线。
function evalNorm(cp) {
  const SCALE = 320; // ~3.2 子时已接近饱和
  return Math.tanh(cp / SCALE);
}

// 红方视角厘兵 → 展示文本（+1.5 / 杀N）
function cpLabel(cp, mate) {
  if (mate) {
    const m = Math.round((MATE_CP - Math.abs(cp)) / 20) + 1;
    return `${cp > 0 ? "红" : "黑"}杀${m > 0 ? m : 1}`;
  }
  const v = cp / 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
}

// 评分走势图：红方视角厘兵值的折线，红优在上（红色填充）、黑优在下（深色填充）；
// 失误点高亮、当前步带数值标签，整图可点击跳转。仿天天象棋优势条。
function EvalCurve({ points, currentStep, onSelect }) {
  const W = 720;
  const H = 180;
  const padX = 6;
  const padY = 10;
  const midY = H / 2;
  const n = points.length;
  const x = (i) => padX + (n <= 1 ? 0 : (i * (W - 2 * padX)) / (n - 1));
  const y = (cp) => midY - evalNorm(cp) * (midY - padY);

  // 顶点坐标
  const pts = points.map((p, i) => [x(i), y(p.cp)]);

  // 平滑折线（Catmull-Rom → 三次贝塞尔），让走势读起来是流畅曲线而非锯齿。
  // 张力系数小、且控制点纵向不外溢，避免在失误尖峰处过冲。
  function smoothPath(coords) {
    if (coords.length < 2) return coords.length ? `M${coords[0][0]},${coords[0][1]}` : "";
    let d = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i - 1] || coords[i];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  const linePath = smoothPath(pts);
  // 面积路径：平滑折线 → 沿中线回到起点闭合，填充「折线与中线之间」的区域。
  // 配合上红下黑的纵向渐变：折线高于中线（红优）填红、低于中线（黑优）填深。
  const areaPath = `${linePath} L${pts[n - 1][0].toFixed(1)},${midY} L${pts[0][0].toFixed(1)},${midY} Z`;

  const dotColor = (q) =>
    q === "blunder" ? "#c0392b" : q === "mistake" ? "#e67e22" : q === "inaccuracy" ? "#c9a227" : null;

  // 当前步在 points 中的下标（currentStep 是局面下标，等于 move_index+1=step）
  const activeIdx = points.findIndex((p) => p.step === currentStep);
  const activePoint = activeIdx >= 0 ? points[activeIdx] : null;

  // 纵轴刻度（仿天天象棋）：标在固定 cp 值上，按 tanh 映射定位百分比，HTML 叠加避免拉伸变形
  const yTicks = [
    { cp: 900, label: "+9" },
    { cp: 300, label: "+3" },
    { cp: 0, label: "0" },
    { cp: -300, label: "−3" },
    { cp: -900, label: "−9" },
  ].map((t) => ({ ...t, top: (y(t.cp) / H) * 100 }));

  // 阶段分界（开局→中局≈第10步、中局→残局≈第40步），用竖线标出，超出本局长度则不画
  const stages = [
    { step: 10, label: "中局" },
    { step: 40, label: "残局" },
  ].filter((s) => s.step < n);

  return (
    <div className="eval-curve">
      <div className="eval-curve-head">
        <span className="review-moves-title">评分走势</span>
        {activePoint && (
          <span className={"eval-curve-now" + (activePoint.cp >= 0 ? " red" : " black")}>
            第 {activePoint.step} 步 {cpLabel(activePoint.cp, activePoint.mate)}
          </span>
        )}
        <span className="eval-curve-legend muted">点击跳转</span>
      </div>

      {/* 图区：左侧纵轴标签 + 主绘图区 */}
      <div className="eval-curve-plot">
        {/* 纵轴刻度标签 */}
        <div className="eval-curve-yaxis">
          {yTicks.map((t) => (
            <span key={t.cp} className="eval-curve-ytick" style={{ top: `${t.top}%` }}>
              {t.label}
            </span>
          ))}
        </div>

        <div className="eval-curve-canvas">
          {/* 红优 / 黑优 角标 */}
          <span className="eval-curve-tag red">红优</span>
          <span className="eval-curve-tag black">黑优</span>

          <svg
            className="eval-curve-svg"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="评分走势图"
          >
            <defs>
              {/* 渐变锁定 SVG 坐标系：50% 对齐中线，红优区暖红、黑优区冷灰 */}
              <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#cf5a52" stopOpacity="0.5" />
                <stop offset="50%" stopColor="#cf5a52" stopOpacity="0.08" />
                <stop offset="50%" stopColor="#3a3a3a" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#3a3a3a" stopOpacity="0.45" />
              </linearGradient>
            </defs>

            {/* 横向刻度网格 */}
            {yTicks.map((t) =>
              t.cp === 0 ? null : (
                <line key={t.cp} x1={0} y1={y(t.cp)} x2={W} y2={y(t.cp)} className="eval-curve-grid" />
              )
            )}
            {/* 中线（均势） */}
            <line x1={0} y1={midY} x2={W} y2={midY} className="eval-curve-mid" />

            {/* 阶段分界竖线 */}
            {stages.map((s) => (
              <line key={s.step} x1={x(s.step)} y1={0} x2={x(s.step)} y2={H} className="eval-curve-stage" />
            ))}

            {/* 当前步竖向指示线 */}
            {activeIdx >= 0 && (
              <line x1={x(activeIdx)} y1={0} x2={x(activeIdx)} y2={H} className="eval-curve-cursor" />
            )}

            {/* 面积填充 + 折线 */}
            <path d={areaPath} fill="url(#evalFill)" stroke="none" />
            <path d={linePath} className="eval-curve-line" fill="none" />

            {points.map((p, i) => {
              const c = dotColor(p.quality);
              const isActive = p.step === currentStep;
              if (!c && !isActive) return null;
              return (
                <circle
                  key={p.step}
                  cx={x(i)}
                  cy={y(p.cp)}
                  r={isActive ? 4.5 : 3.5}
                  fill={c || "#138a43"}
                  stroke="#fff"
                  strokeWidth="1.5"
                />
              );
            })}

            {/* 透明热区：点击就近选中着法 */}
            {points.map((p, i) => {
              const left = i === 0 ? 0 : (x(i - 1) + x(i)) / 2;
              const right = i === n - 1 ? W : (x(i) + x(i + 1)) / 2;
              return (
                <rect
                  key={"hit" + p.step}
                  x={left}
                  y="0"
                  width={Math.max(0, right - left)}
                  height={H}
                  fill="transparent"
                  className="eval-curve-hit"
                  onClick={() => onSelect(p.step)}
                >
                  <title>{`第 ${p.step} 步 · ${cpLabel(p.cp, p.mate)}`}</title>
                </rect>
              );
            })}
          </svg>

          {/* 阶段标签（HTML 叠加，跟随竖线） */}
          {stages.map((s) => (
            <span
              key={s.step}
              className="eval-curve-stage-label"
              style={{ left: `${(x(s.step) / W) * 100}%` }}
            >
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ summary, blunderList = [], moveAnalysis, stepIndex, preFen, onSelectStep, onNavigateToTrain }) {
  const badgeInfo = moveAnalysis
    ? moveAnalysis.is_blunder
      ? { text: "严重失误", color: "#c0392b", bg: "#ffebee" }
      : moveAnalysis.is_mistake
      ? { text: "失误", color: "#e67e22", bg: "#fff3e0" }
      : moveAnalysis.move_played !== moveAnalysis.best_move
      ? { text: "可改进", color: "#b8860b", bg: "#fffde7" }
      : null
    : null;

  const evalDrop = moveAnalysis && moveAnalysis.eval_drop != null
    ? (moveAnalysis.eval_drop / 100).toFixed(1)
    : null;

  return (
    <div className="analysis-panel">
      {/* Summary + 可点击失误列表 */}
      <div className="analysis-summary">
        <span style={{ color: "#c0392b", fontWeight: 600 }}>
          {summary.blunder_count} 处严重失误
        </span>
        <span style={{ color: "#888", margin: "0 6px" }}>，</span>
        <span style={{ color: "#e67e22", fontWeight: 600 }}>
          {summary.mistake_count} 处失误
        </span>
      </div>
      {blunderList.length > 0 ? (
        <div className="blunder-cols">
          {[
            { side: "红", label: "红方失误", cls: "red" },
            { side: "黑", label: "黑方失误", cls: "black" },
          ].map((col) => {
            const items = blunderList.filter((b) => b.side === col.side);
            return (
              <div key={col.side} className={"blunder-col " + col.cls}>
                <div className="blunder-col-head">
                  {col.label}
                  <span className="blunder-col-count">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="blunder-col-empty muted">无</div>
                ) : (
                  <div className="blunder-list">
                    {items.map((b) => (
                      <button
                        key={b.step}
                        className={
                          "blunder-chip" +
                          (b.isBlunder ? " blunder" : " mistake") +
                          (stepIndex === b.step ? " active" : "")
                        }
                        onClick={() => onSelectStep && onSelectStep(b.step)}
                        title={`跳到第 ${b.step} 步`}
                      >
                        <span className="blunder-chip-dot">●</span>
                        <span className="blunder-chip-step">{b.step}.</span>
                        <span className="blunder-chip-move">{b.text}</span>
                        {b.evalDrop != null && (
                          <span className="blunder-chip-drop">−{Math.abs(b.evalDrop).toFixed(1)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          本局没有明显失误，走得很稳。
        </div>
      )}

      {/* Move detail */}
      {moveAnalysis && stepIndex > 0 ? (
        <div className="analysis-detail">
          <div className="analysis-detail-header">
            <span className="analysis-move-label">第 {stepIndex} 步</span>
            {badgeInfo && (
              <span
                className="analysis-badge"
                style={{ color: badgeInfo.color, background: badgeInfo.bg }}
              >
                {badgeInfo.text}
              </span>
            )}
          </div>
          <div className="analysis-moves-row">
            <span>实际走法：<strong>{preFen ? uciToChinese(preFen, moveAnalysis.move_played) : moveAnalysis.move_played}</strong></span>
            <span className="analysis-arrow">→</span>
            <span>最优走法：<strong>{preFen ? uciToChinese(preFen, moveAnalysis.best_move) : moveAnalysis.best_move}</strong></span>
          </div>
          {evalDrop !== null && (
            <div className="analysis-eval-drop muted">
              失分：约 {evalDrop} 个子
            </div>
          )}
          {moveAnalysis.explanation && (
            <div className="analysis-explanation markdown-body">
              <ReactMarkdown>{moveAnalysis.explanation}</ReactMarkdown>
            </div>
          )}
          {moveAnalysis.puzzle_id && (
            <button
              className="btn-analyze"
              style={{ marginTop: 8 }}
              onClick={() => onNavigateToTrain && onNavigateToTrain(moveAnalysis.puzzle_id)}
            >
              去练习这道题
            </button>
          )}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          点击某步棋查看分析详情
        </div>
      )}
    </div>
  );
}
