// 浏览器本地 UCI 引擎（WebAssembly）封装。
//
// 把 Pikafish 的 WASM 构建产物放到 public/engine/ 下（见该目录 README）：
//   pikafish.worker.js / pikafish.js / pikafish.wasm / pikafish.data
// 文件存在即自动启用：评估、提示在用户浏览器里完成，服务器零开销；
// 文件缺失或加载失败时由调用方降级到服务器接口，功能不受影响。
//
// 通信协议为标准 UCI 文本（Web Worker postMessage 一行一条），与主流
// WASM 引擎构建（Emscripten + worker 包装）兼容。

const INIT_TIMEOUT = 60000; // Android 首次读取 18MB 权重并编译 wasm，低端设备需更久
const GO_TIMEOUT = 15000;

const runtimes = new Map();
import { abortError, analysisResult, goCommand, parseUciInfo, redPerspective } from "./core/engine/uci.js";

function filesFor(variant) {
  const dir = variant === "jieqi" ? "/engine/jieqi" : "/engine";
  return { js: `${dir}/pikafish.worker.js`, glue: `${dir}/pikafish.js`, wasm: `${dir}/pikafish.wasm`, nnue: "pikafish.nnue" };
}

function getRuntime(variant) {
  if (!runtimes.has(variant)) runtimes.set(variant, { probePromise: null, queue: Promise.resolve() });
  return runtimes.get(variant);
}

// 探测引擎文件是否就位。Android WebView 的自定义资源协议不一定实现 HEAD，
// 因此读取很小的 Worker 脚本；SPA 兜底返回 HTML 时再由 Content-Type 排除。
async function engineFilesPresent(engineJs) {
  try {
    const r = await fetch(engineJs, { method: "GET" });
    if (!r.ok) return false;
    const ct = r.headers.get("content-type") || "";
    // 只检查响应头，避免探测时完整下载大型 WASM 文件。
    await r.body?.cancel();
    return /javascript|ecmascript|wasm|octet-stream/i.test(ct);
  } catch {
    return false;
  }
}

// 启动 worker 并完成 UCI 握手，失败返回 null。
function bootWorker(variant) {
  return new Promise((resolve) => {
    const files = filesFor(variant);
    let worker;
    try {
      worker = new Worker(files.js);
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, INIT_TIMEOUT);
    let uciok = false;
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(null);
    };
    worker.onmessage = (e) => {
      if (e.data?.type === "error") {
        clearTimeout(timer);
        worker.terminate();
        resolve(null);
        return;
      }
      const line = typeof e.data === "string" ? e.data : "";
      if (line.startsWith("uciok")) {
        uciok = true;
        // 权重文件由引擎自行加载；构建若已内嵌网络则该选项被忽略
        worker.postMessage(`setoption name EvalFile value ${files.nnue}`);
        worker.postMessage("isready");
      } else if (uciok && line.startsWith("readyok")) {
        clearTimeout(timer);
        resolve(worker);
      }
    };
    worker.postMessage("uci");
  });
}

// 返回就绪的 worker 或 null（不可用）。整个会话只探测/启动一次。
export function getLocalEngine(variant = "xiangqi") {
  const state = getRuntime(variant);
  if (!state.probePromise) {
    state.probePromise = (async () => {
      const files = filesFor(variant);
      if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return null;
      for (const path of [files.js, files.glue, files.wasm]) {
        if (!(await engineFilesPresent(path))) return null;
      }
      return bootWorker(variant);
    })();
  }
  return state.probePromise;
}

// 是否可用（用于界面徽标展示）
export async function localEngineReady(variant = "xiangqi") {
  return (await getLocalEngine(variant)) !== null;
}

// 分析一个局面，返回**红方视角**的 {cp, mate, bestMove, pv}（与服务器
// /play/eval 语义一致，调用方无需区分本地/远端）。失败时抛错，由调用方降级。
export function localEval(fen, options = {}) {
  const { variant = "xiangqi", signal, onUpdate } = options;
  const state = getRuntime(variant);
  const run = async () => {
    if (signal?.aborted) throw abortError();
    const worker = await getLocalEngine(variant);
    if (!worker) throw new Error("本地引擎不可用");
    return new Promise((resolve, reject) => {
      const latestByPv = new Map();
      let stopping = false;
      const failWorker = (error) => {
        cleanup();
        worker.terminate();
        state.probePromise = Promise.resolve(null);
        reject(error);
      };
      const timeoutMs = options.mode === "infinite" ? null : Math.max(GO_TIMEOUT, Number(options.value) + 5000 || 0);
      const timer = timeoutMs == null ? null : setTimeout(() => {
        // 损坏或卡死的 Worker 可能永远不回 bestmove，必须结束 Promise 才能降级。
        failWorker(new Error("本地引擎分析超时"));
      }, timeoutMs);
      const onAbort = () => {
        stopping = true;
        failWorker(abortError());
      };
      const onError = () => failWorker(new Error("本地引擎运行失败"));
      const onMessage = (e) => {
        const line = typeof e.data === "string" ? e.data : "";
        if (line.startsWith("info ")) {
          const parsed = redPerspective(parseUciInfo(line), fen);
          if (!parsed) return;
          const previous = latestByPv.get(parsed.multipv) || {};
          latestByPv.set(parsed.multipv, { ...previous, ...parsed });
          onUpdate?.({ status: "searching", ...analysisResult(latestByPv) });
        } else if (line.startsWith("bestmove")) {
          cleanup();
          const mv = line.split(/\s+/)[1];
          if (signal?.aborted) reject(abortError());
          else if (stopping) reject(new Error("分析超时"));
          else resolve(analysisResult(latestByPv, mv && mv !== "(none)" ? mv : null));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      worker.postMessage(`setoption name MultiPV value ${Math.max(1, Math.min(10, Number(options.multiPv) || 1))}`);
      if (options.showWdl) worker.postMessage("setoption name UCI_ShowWDL value true");
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(goCommand(options));
    });
  };
  // 串行执行：上一个请求失败也不阻塞下一个
  const task = state.queue.then(run, run);
  state.queue = task.catch(() => {});
  return task;
}
