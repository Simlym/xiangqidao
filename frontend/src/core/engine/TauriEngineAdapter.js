import { EngineAdapter } from "./EngineAdapter";
import { RUNTIME, runtime } from "../../platform/runtime";

const profileKey = (variant) => `xq.nativeEngine.${variant}`;
const INIT_TIMEOUT = 10000;
const GO_TIMEOUT = 30000;
const JIEQI_PROBE_FEN = "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w A2B2N2R2C2P5a2b2n2r2c2p5 - 0 1";
let activeNativeVariant = null;

function safeProfile(profile) {
  const cpuCount = Number(globalThis.navigator?.hardwareConcurrency) || 4;
  return {
    ...profile,
    args: Array.isArray(profile?.args) ? profile.args : [],
    threads: Math.max(1, Math.min(8, Number(profile?.threads) || Math.min(4, Math.ceil(cpuCount / 2)))),
    hashMb: Math.max(32, Math.min(2048, Number(profile?.hashMb) || 256)),
  };
}

export class TauriEngineAdapter extends EngineAdapter {
  constructor(variant = "xiangqi") {
    super("native");
    this.variant = variant;
    this.started = false;
    this.startPromise = null;
    this.listeners = new Set();
    this.unlisten = null;
    this.queue = Promise.resolve();
    this.lastError = null;
    this.diagnostics = [];
  }

  getProfile() {
    if (runtime !== RUNTIME.TAURI) return null;
    try {
      const profile = JSON.parse(localStorage.getItem(profileKey(this.variant))) || null;
      return profile ? safeProfile(profile) : null;
    } catch {
      return null;
    }
  }

  async ready() {
    if (runtime !== RUNTIME.TAURI || !this.getProfile()?.path) return false;
    try {
      await this.start();
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      return false;
    }
  }

  async modules() {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);
    return { invoke, listen };
  }

  async start() {
    if (this.started && activeNativeVariant === this.variant) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.boot();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async boot() {
    const profile = this.getProfile();
    if (!profile?.path) throw new Error("尚未配置桌面原生引擎");
    const { invoke, listen } = await this.modules();
    this.diagnostics = [];
    this.unlisten ||= await listen("engine-output", ({ payload }) => {
      for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
        this.rememberDiagnostic(line);
        for (const listener of this.listeners) listener(line);
      }
    });
    this.unlistenError ||= await listen("engine-error", ({ payload }) => {
      for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
        this.rememberDiagnostic(line);
      }
    });
    await invoke("spawn_engine", { path: profile.path, args: profile.args || [] });
    await this.waitFor("uciok", () => invoke("send_to_engine", { command: "uci" }), INIT_TIMEOUT);
    await invoke("send_to_engine", { command: `setoption name Threads value ${profile.threads}` });
    await invoke("send_to_engine", { command: `setoption name Hash value ${profile.hashMb}` });
    await invoke("send_to_engine", { command: "setoption name MultiPV value 1" });
    await invoke("send_to_engine", { command: "ucinewgame" });
    await this.waitFor("readyok", () => invoke("send_to_engine", { command: "isready" }), INIT_TIMEOUT);
    if (this.variant === "jieqi") {
      await this.waitFor("bestmove", async () => {
        await invoke("send_to_engine", { command: `position fen ${JIEQI_PROBE_FEN}` });
        await invoke("send_to_engine", { command: "go depth 1" });
      }, INIT_TIMEOUT);
      await invoke("send_to_engine", { command: "ucinewgame" });
    }
    this.started = true;
    activeNativeVariant = this.variant;
  }

  waitFor(prefix, action, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(onLine);
        const detail = this.diagnostics.slice(-3).join("；");
        reject(new Error(`等待 ${prefix} 超时${detail ? `（引擎输出：${detail}` + "）" : ""}`));
      }, timeout);
      const onLine = (line) => {
        if (!line.startsWith(prefix)) return;
        clearTimeout(timer);
        this.listeners.delete(onLine);
        resolve(line);
      };
      this.listeners.add(onLine);
      Promise.resolve(action()).catch((error) => {
        clearTimeout(timer);
        this.listeners.delete(onLine);
        reject(error);
      });
    });
  }

  rememberDiagnostic(line) {
    const text = String(line).trim();
    if (!text) return;
    this.diagnostics.push(text.slice(0, 300));
    if (this.diagnostics.length > 20) this.diagnostics.shift();
  }

  evaluate(fen, { depth = 14 } = {}) {
    const run = async () => {
      await this.start();
      const { invoke } = await this.modules();
      const sign = (fen.split(/\s+/)[1] || "w") === "w" ? 1 : -1;
      let latest = {};
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          invoke("send_to_engine", { command: "stop" }).catch(() => {});
          cleanup();
          reject(new Error("原生引擎分析超时"));
        }, GO_TIMEOUT);
        const cleanup = () => {
          clearTimeout(timer);
          this.listeners.delete(onLine);
        };
        const onLine = (line) => {
          if (line.startsWith("info ")) {
            const score = line.match(/score (cp|mate) (-?\d+)/);
            const pv = line.match(/\bpv ([a-i]\d[a-i]\d.*)$/);
            if (score) latest[score[1]] = Number(score[2]);
            if (pv) latest.pv = pv[1].trim().split(/\s+/);
          } else if (line.startsWith("bestmove")) {
            cleanup();
            const move = line.split(/\s+/)[1];
            resolve({
              cp: latest.mate == null && latest.cp != null ? sign * latest.cp : null,
              mate: latest.mate != null ? sign * latest.mate : null,
              bestMove: move && move !== "(none)" ? move : null,
              pv: latest.pv || null,
            });
          }
        };
        this.listeners.add(onLine);
        invoke("send_to_engine", { command: `position fen ${fen}` })
          .then(() => invoke("send_to_engine", { command: `go depth ${depth}` }))
          .catch((error) => {
            cleanup();
            reject(error);
          });
      });
    };
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => {});
    return task;
  }

  async dispose() {
    if (runtime !== RUNTIME.TAURI) return;
    const { invoke } = await this.modules();
    await invoke("kill_engine").catch(() => {});
    this.unlisten?.();
    this.unlistenError?.();
    this.unlisten = null;
    this.unlistenError = null;
    this.started = false;
    if (activeNativeVariant === this.variant) activeNativeVariant = null;
  }
}

export function saveNativeEngineProfile(profile, variant = "xiangqi") {
  localStorage.setItem(profileKey(variant), JSON.stringify(safeProfile(profile)));
}

export function getNativeEngineProfile(variant = "xiangqi") {
  try {
    const profile = JSON.parse(localStorage.getItem(profileKey(variant))) || null;
    return profile ? safeProfile(profile) : null;
  } catch {
    return null;
  }
}
