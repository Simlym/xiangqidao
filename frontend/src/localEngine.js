// 浏览器本地 UCI 引擎（WebAssembly）封装。
//
// 把 Pikafish 的 WASM 构建产物放到 public/engine/ 下（见该目录 README）：
//   pikafish.js / pikafish.wasm / pikafish.nnue
// 文件存在即自动启用：评估、提示在用户浏览器里完成，服务器零开销；
// 文件缺失或加载失败时由调用方降级到服务器接口，功能不受影响。
//
// 通信协议为标准 UCI 文本（Web Worker postMessage 一行一条），与主流
// WASM 引擎构建（Emscripten + worker 包装）兼容。

const INIT_TIMEOUT = 20000; // 首次加载含 wasm 编译 + 网络权重，放宽些
const GO_TIMEOUT = 15000;

const runtimes = new Map();

function filesFor(variant) {
  const dir = variant === "jieqi" ? "/engine/jieqi" : "/engine";
  return { js: `${dir}/pikafish.js`, nnue: `${dir}/pikafish.nnue` };
}

function getRuntime(variant) {
  if (!runtimes.has(variant)) runtimes.set(variant, { probePromise: null, queue: Promise.resolve() });
  return runtimes.get(variant);
}

// 探测引擎文件是否就位。生产环境常见 SPA 兜底会把任意路径重写到
// index.html 并返回 200，因此还要校验 Content-Type 确实是脚本。
async function engineFilesPresent(engineJs) {
  try {
    const r = await fetch(engineJs, { method: "HEAD" });
    if (!r.ok) return false;
    const ct = r.headers.get("content-type") || "";
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
      if (!(await engineFilesPresent(files.js))) return null;
      return bootWorker(variant);
    })();
  }
  return state.probePromise;
}

// 是否可用（用于界面徽标展示）
export async function localEngineReady(variant = "xiangqi") {
  return (await getLocalEngine(variant)) !== null;
}

// 解析 "info ... score cp 35 ... pv h2e2 ..." 行
function parseInfo(line) {
  const out = {};
  let m = line.match(/score (cp|mate) (-?\d+)/);
  if (m) {
    if (m[1] === "cp") out.cp = Number(m[2]);
    else out.mate = Number(m[2]);
  }
  m = line.match(/\bpv ([a-i]\d[a-i]\d.*)$/);
  if (m) out.pv = m[1].trim().split(/\s+/);
  return out;
}

// 分析一个局面，返回**红方视角**的 {cp, mate, bestMove, pv}（与服务器
// /play/eval 语义一致，调用方无需区分本地/远端）。失败时抛错，由调用方降级。
export function localEval(fen, { depth = 12, variant = "xiangqi" } = {}) {
  const state = getRuntime(variant);
  const run = async () => {
    const worker = await getLocalEngine(variant);
    if (!worker) throw new Error("本地引擎不可用");
    return new Promise((resolve, reject) => {
      const sign = (fen.split(/\s+/)[1] || "w") === "w" ? 1 : -1; // 走子方 → 红方视角
      let last = {};
      const timer = setTimeout(() => {
        worker.postMessage("stop");
        cleanup();
        reject(new Error("分析超时"));
      }, GO_TIMEOUT);
      const onMessage = (e) => {
        const line = typeof e.data === "string" ? e.data : "";
        if (line.startsWith("info ")) {
          Object.assign(last, parseInfo(line));
        } else if (line.startsWith("bestmove")) {
          cleanup();
          const mv = line.split(/\s+/)[1];
          resolve({
            cp: last.mate != null ? null : last.cp != null ? sign * last.cp : null,
            mate: last.mate != null ? sign * last.mate : null,
            bestMove: mv && mv !== "(none)" ? mv : null,
            pv: last.pv || null,
          });
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  };
  // 串行执行：上一个请求失败也不阻塞下一个
  const task = state.queue.then(run, run);
  state.queue = task.catch(() => {});
  return task;
}
