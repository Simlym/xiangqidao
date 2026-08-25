import { EngineAdapter } from "./EngineAdapter";
import { RUNTIME, runtime } from "../../platform/runtime";

const PROFILE_KEY = "xq.nativeEngine.xiangqi";
const INIT_TIMEOUT = 10000;
const GO_TIMEOUT = 30000;

export class TauriEngineAdapter extends EngineAdapter {
  constructor() {
    super("native");
    this.started = false;
    this.startPromise = null;
    this.listeners = new Set();
    this.unlisten = null;
    this.queue = Promise.resolve();
  }

  getProfile() {
    if (runtime !== RUNTIME.TAURI) return null;
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;
    } catch {
      return null;
    }
  }

  async ready() {
    if (runtime !== RUNTIME.TAURI || !this.getProfile()?.path) return false;
    try {
      await this.start();
      return true;
    } catch {
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
    if (this.started) return;
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
    this.unlisten ||= await listen("engine-output", ({ payload }) => {
      for (const line of String(payload).split(/\r?\n/).filter(Boolean)) {
        for (const listener of this.listeners) listener(line);
      }
    });
    await invoke("spawn_engine", { path: profile.path, args: profile.args || [] });
    await this.waitFor("uciok", () => invoke("send_to_engine", { command: "uci" }), INIT_TIMEOUT);
    await this.waitFor("readyok", () => invoke("send_to_engine", { command: "isready" }), INIT_TIMEOUT);
    this.started = true;
  }

  waitFor(prefix, action, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(onLine);
        reject(new Error(`等待 ${prefix} 超时`));
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
    this.unlisten = null;
    this.started = false;
  }
}

export function saveNativeEngineProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function getNativeEngineProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;
  } catch {
    return null;
  }
}
