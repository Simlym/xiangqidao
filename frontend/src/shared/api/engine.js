import { API_BASE_URL, authHeaders, readableErrorDetail, request } from "./client.js";

export const newPlayGame = (payload) => request("/play/new", { method: "POST", body: payload });
export const playMove = (payload) => request("/play/move", { method: "POST", body: payload });
export const getPositionState = (fen) => request("/play/state", { method: "POST", body: { fen } });

export function enginePayload(fen, options = {}) {
  return {
    fen, depth: options.depth || 12, mode: options.mode || "depth", value: options.value ?? null,
    multipv: options.multiPv || 1, show_wdl: Boolean(options.showWdl), search_moves: options.searchMoves || [],
  };
}

export function normalizeEngineResult(result) {
  const normalizeWdl = (wdl) => Array.isArray(wdl) ? { win: wdl[0], draw: wdl[1], loss: wdl[2] } : wdl;
  const lines = (result.lines || []).map((line) => ({
    ...line,
    score: line.score_mate != null
      ? { type: "mate", value: line.score_mate, pov: "red" }
      : line.score_cp != null ? { type: "cp", value: line.score_cp, pov: "red" } : null,
    timeMs: line.time_ms,
    wdl: normalizeWdl(line.wdl),
  }));
  return { ...result, bestMove: result.best_move, timeMs: result.time_ms, wdl: normalizeWdl(result.wdl), lines };
}

async function streamEngine(path, fen, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(enginePayload(fen, options)),
    signal: options.signal,
  });
  if (!response.ok) {
    let message = "流式分析启动失败";
    try { message = readableErrorDetail((await response.json()).detail); } catch { /* 使用通用提示 */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error("当前环境不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const linesByPv = new Map();
  let buffer = "";
  let finalResult = null;

  const consume = (raw) => {
    if (!raw.trim()) return;
    const event = JSON.parse(raw);
    if (event.type === "error") throw new Error(event.data?.message || "引擎分析失败");
    const value = normalizeEngineResult(event.data || {});
    if (event.type === "info") {
      for (const line of value.lines || []) linesByPv.set(line.multipv || 1, line);
      const lines = [...linesByPv.values()].sort((a, b) => (a.multipv || 1) - (b.multipv || 1));
      const best = lines[0];
      options.onUpdate?.({
        ...value,
        cp: best?.score?.type === "cp" ? best.score.value : value.cp,
        mate: best?.score?.type === "mate" ? best.score.value : value.mate,
        bestMove: best?.pv?.[0] || value.bestMove,
        pv: best?.pv || value.pv,
        wdl: best?.wdl || value.wdl,
        lines,
      });
    } else if (event.type === "complete") finalResult = value;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const rows = buffer.split("\n");
    buffer = rows.pop() || "";
    for (const row of rows) consume(row);
    if (done) break;
  }
  if (buffer) consume(buffer);
  if (!finalResult) throw new Error("流式分析未返回最终结果");
  return finalResult;
}

export const evalPosition = async (fen, options = {}) => normalizeEngineResult(await request("/play/eval", { method: "POST", body: enginePayload(fen, options), signal: options.signal }));
export const streamEvalPosition = (fen, options = {}) => streamEngine("/play/eval/stream", fen, options);
export const getPlayEngine = () => request("/play/engine");
export const getBookMoves = (fen) => request(`/play/book?fen=${encodeURIComponent(fen)}`);
export const getHint = (fen) => request("/play/hint", { method: "POST", body: { fen } });
export const coachHintMove = (fen, move) => request("/play/coach", { method: "POST", body: { fen, move } });
export const evalJieqiPosition = async (fen, options = {}) => normalizeEngineResult(await request("/variants/jieqi/eval", { method: "POST", body: enginePayload(fen, options), signal: options.signal }));
export const streamJieqiPosition = (fen, options = {}) => streamEngine("/variants/jieqi/eval/stream", fen, options);
