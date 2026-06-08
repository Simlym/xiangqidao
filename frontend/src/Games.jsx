import React from "react";
import Board from "./Board";
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

export default function Games({ onNavigateToTrain }) {
  const [games, setGames] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState(null);
  const [positions, setPositions] = React.useState(null);
  const [posLoading, setPosLoading] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [showImport, setShowImport] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState("");
  const moveListRef = React.useRef(null);

  // Analysis state
  const [analyzeStatus, setAnalyzeStatus] = React.useState("idle"); // idle | analyzing | done
  const [analysisData, setAnalysisData] = React.useState(null); // null or {moves, blunder_count, mistake_count}
  const [progress, setProgress] = React.useState({ analyzed: 0, total: 0 });
  const pollRef = React.useRef(null);

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

  // Reset analysis when game changes
  React.useEffect(() => {
    setAnalyzeStatus("idle");
    setAnalysisData(null);
    setProgress({ analyzed: 0, total: 0 });
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [selectedId]);

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
  const movesList = positions?.moves || [];
  const currentPos = positionsList[stepIndex] || null;
  const currentFen = currentPos?.fen || "";
  // lastMove is the move that led to current position
  const lastMove = stepIndex > 0 ? movesList[stepIndex - 1] : null;

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

  // Current analysis detail: stepIndex corresponds to move at index stepIndex-1
  const currentMoveAnalysis = stepIndex > 0 ? analysisMap[stepIndex - 1] : null;

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
    setAnalyzeStatus("analyzing");
    setProgress({ analyzed: 0, total: 0 });
    try {
      await analyzeGame(selectedId);
    } catch {
      // ignore, still start polling
    }
    // Start polling（带进度）
    pollRef.current = setInterval(async () => {
      try {
        const result = await getAnalysis(selectedId);
        if (result.total != null) {
          setProgress({ analyzed: result.analyzed || 0, total: result.total });
        }
        if (result.status === "done") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setAnalyzeStatus("done");
          setAnalysisData(result);
        }
      } catch {
        // keep polling
      }
    }, 1000);
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
                <div className="game-item-players">
                  <span className="game-red">{g.red_player || "红方"}</span>
                  <span className="game-vs"> vs </span>
                  <span className="game-black">{g.black_player || "黑方"}</span>
                </div>
                <div className="game-item-meta">
                  <span className="game-date muted">{g.date || ""}</span>
                  <span
                    className="game-result-tag"
                    style={{ color: rl.color, borderColor: rl.color }}
                  >
                    {rl.text}
                  </span>
                  <button
                    className="game-delete-btn"
                    title="删除"
                    onClick={(e) => handleDelete(e, g.id)}
                  >
                    ×
                  </button>
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
            {/* Board */}
            <div className="review-board-wrap">
              {/* Analyze button row */}
              <div className="review-meta-row">
                <button
                  className={"btn-analyze" + (analyzeStatus === "analyzing" ? " analyzing" : "")}
                  onClick={handleAnalyze}
                  disabled={analyzeStatus === "analyzing" || analyzeStatus === "done"}
                >
                  {analyzeStatus === "analyzing"
                    ? "分析中…"
                    : analyzeStatus === "done"
                    ? "已分析"
                    : "分析此局"}
                </button>
                {analyzeStatus === "analyzing" && (
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
                )}
              </div>

              {currentFen ? (
                <Board
                  fen={currentFen}
                  onMove={() => {}}
                  lastMove={lastMove}
                  disabled={true}
                />
              ) : (
                <div className="muted">无棋盘数据</div>
              )}
              {/* Nav buttons */}
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
              </div>
            </div>

            {/* Move list */}
            <div className="review-moves-wrap">
              <div className="review-moves-title">着法列表</div>
              <div className="review-moves-list" ref={moveListRef}>
                {rounds.map(({ round, red, black }) => (
                  <div key={round} className="move-round">
                    <span className="move-round-num">{round}.</span>
                    <MoveItem
                      moveIndex={red}
                      moveText={movesList[red] || ""}
                      isActive={stepIndex === red + 1}
                      analysisEntry={analysisMap[red]}
                      onClick={() => setStepIndex(red + 1)}
                    />
                    {movesList[black] !== undefined && (
                      <MoveItem
                        moveIndex={black}
                        moveText={movesList[black]}
                        isActive={stepIndex === black + 1}
                        analysisEntry={analysisMap[black]}
                        onClick={() => setStepIndex(black + 1)}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Analysis detail panel */}
              {analyzeStatus === "done" && analysisData && (
                <AnalysisPanel
                  summary={{ blunder_count: analysisData.blunder_count, mistake_count: analysisData.mistake_count }}
                  moveAnalysis={currentMoveAnalysis}
                  stepIndex={stepIndex}
                  onNavigateToTrain={onNavigateToTrain}
                />
              )}
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

  return (
    <span
      className={"move-item" + (isActive ? " active" : "") + extraClass}
      onClick={onClick}
    >
      {moveText}
    </span>
  );
}

function AnalysisPanel({ summary, moveAnalysis, stepIndex, onNavigateToTrain }) {
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
      {/* Summary */}
      <div className="analysis-summary">
        <span style={{ color: "#c0392b", fontWeight: 600 }}>
          {summary.blunder_count} 处严重失误
        </span>
        <span style={{ color: "#888", margin: "0 6px" }}>，</span>
        <span style={{ color: "#e67e22", fontWeight: 600 }}>
          {summary.mistake_count} 处失误
        </span>
      </div>

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
            <span>实际走法：<strong>{moveAnalysis.move_played}</strong></span>
            <span className="analysis-arrow">→</span>
            <span>最优走法：<strong>{moveAnalysis.best_move}</strong></span>
          </div>
          {evalDrop !== null && (
            <div className="analysis-eval-drop muted">
              失分：约 {evalDrop} 个子
            </div>
          )}
          {moveAnalysis.explanation && (
            <div className="analysis-explanation">
              {moveAnalysis.explanation}
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
