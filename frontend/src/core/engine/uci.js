const MOVE_RE = /^[a-i][0-9][a-i][0-9][a-zA-Z]{0,2}$/;

function numberAfter(tokens, name) {
  const index = tokens.indexOf(name);
  if (index < 0 || index + 1 >= tokens.length) return undefined;
  const value = Number(tokens[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

// 将一行 UCI info 解析成与运行时无关的结构。未出现的字段保持 undefined，
// 调用方可把同一条 MultiPV 在不同深度的输出渐进合并。
export function parseUciInfo(line) {
  if (typeof line !== "string" || !line.startsWith("info ")) return null;
  const tokens = line.trim().split(/\s+/);
  const update = {
    depth: numberAfter(tokens, "depth"),
    seldepth: numberAfter(tokens, "seldepth"),
    multipv: numberAfter(tokens, "multipv") || 1,
    nodes: numberAfter(tokens, "nodes"),
    nps: numberAfter(tokens, "nps"),
    timeMs: numberAfter(tokens, "time"),
  };

  const scoreIndex = tokens.indexOf("score");
  if (scoreIndex >= 0 && scoreIndex + 2 < tokens.length) {
    const type = tokens[scoreIndex + 1];
    const value = Number(tokens[scoreIndex + 2]);
    if ((type === "cp" || type === "mate") && Number.isFinite(value)) {
      update.score = {
        type,
        value,
        bound: tokens[scoreIndex + 3] === "lowerbound" || tokens[scoreIndex + 3] === "upperbound"
          ? tokens[scoreIndex + 3]
          : null,
      };
    }
  }

  const wdlIndex = tokens.indexOf("wdl");
  if (wdlIndex >= 0 && wdlIndex + 3 < tokens.length) {
    const values = tokens.slice(wdlIndex + 1, wdlIndex + 4).map(Number);
    if (values.every(Number.isFinite)) {
      update.wdl = { win: values[0], draw: values[1], loss: values[2] };
    }
  }

  const pvIndex = tokens.indexOf("pv");
  if (pvIndex >= 0) update.pv = tokens.slice(pvIndex + 1).filter((item) => MOVE_RE.test(item));
  return update;
}

export function redPerspective(update, fen) {
  if (!update) return update;
  const sign = (fen.split(/\s+/)[1] || "w") === "w" ? 1 : -1;
  const next = { ...update };
  if (update.score) next.score = { ...update.score, value: sign * update.score.value, pov: "red" };
  if (update.wdl) {
    next.wdl = sign === 1
      ? { ...update.wdl }
      : { win: update.wdl.loss, draw: update.wdl.draw, loss: update.wdl.win };
  }
  return next;
}

export function goCommand(options = {}) {
  const mode = options.mode || (options.movetime != null ? "movetime" : "depth");
  let command;
  if (mode === "infinite") command = "go infinite";
  else if (mode === "movetime") command = `go movetime ${Math.max(50, Number(options.value ?? options.movetime) || 1000)}`;
  else command = `go depth ${Math.max(1, Number(options.value ?? options.depth) || 12)}`;
  if (options.searchMoves?.length) command += ` searchmoves ${options.searchMoves.join(" ")}`;
  return command;
}

export function analysisResult(latestByPv, bestMove = null) {
  const lines = [...latestByPv.entries()]
    .sort(([a], [b]) => a - b)
    .map(([multipv, item]) => ({ multipv, ...item }));
  const best = lines[0] || {};
  return {
    cp: best.score?.type === "cp" ? best.score.value : null,
    mate: best.score?.type === "mate" ? best.score.value : null,
    bestMove: best.pv?.[0] || bestMove,
    pv: best.pv || null,
    depth: best.depth,
    seldepth: best.seldepth,
    nodes: best.nodes,
    nps: best.nps,
    timeMs: best.timeMs,
    wdl: best.wdl || null,
    lines,
  };
}

export function abortError() {
  return new DOMException("分析已停止", "AbortError");
}
