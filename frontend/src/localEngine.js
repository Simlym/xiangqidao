// 浏览器本地 UCI 引擎（WebAssembly）封装。
//
// 把 Pikafish 的 WASM 构建产物放到 public/engine/ 下（见该目录 README）：
//   pikafish.js / pikafish.wasm / pikafish.nnue
// 文件存在即自动启用：评估、提示在用户浏览器里完成，服务器零开销；
// 文件缺失或加载失败时由调用方降级到服务器接口，功能不受影响。
//
// 通信协议为标准 UCI 文本（Web Worker postMessage 一行一条），与主流
// WASM 引擎构建（Emscripten + worker 包装）兼容。

const ENGINE_DIR = "/engine";
const ENGINE_JS = `${ENGINE_DIR}/pikafish.js`;
const ENGINE_NNUE = `${ENGINE_DIR}/pikafish.nnue`;
const INIT_TIMEOUT = 20000; // 首次加载含 wasm 编译 + 网络权重，放宽些
const GO_TIMEOUT = 15000;

let probePromise = null; // null=未探测；Promise<Worker|null>
let queue = Promise.resolve(); // 串行化分析请求（单引擎进程）

// 探测引擎文件是否就位。生产环境常见 SPA 兜底会把任意路径重写到
// index.html 并返回 200，因此还要校验 Content-Type 确实是脚本。
async function engineFilesPresent() {
  try {
    const r = await fetch(ENGINE_JS, { method: "HEAD" });
    if (!r.ok) return false;
    const ct = r.headers.get("content-type") || "";
    return /javascript|ecmascript|wasm|octet-stream/i.test(ct);
  } catch {
    return false;
  }
}

// 启动 worker 并完成 UCI 握手，失败返回 null。
function bootWorker() {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(ENGINE_JS);
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
        worker.postMessage(`setoption name EvalFile value ${ENGINE_NNUE}`);
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
export function getLocalEngine() {
  if (!probePromise) {
    probePromise = (async () => {
      if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return null;
      if (!(await engineFilesPresent())) return null;
      return bootWorker();
    })();
  }
  return probePromise;
}

// 是否可用（用于界面徽标展示）
export async function localEngineReady() {
  return (await getLocalEngine()) !== null;
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
export function localEval(fen, { depth = 12 } = {}) {
  const run = async () => {
    const worker = await getLocalEngine();
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
  const task = queue.then(run, run);
  queue = task.catch(() => {});
  return task;
}
