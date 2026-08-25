// 引擎运行时的最小契约。UI 只依赖这个接口，不直接感知 Web Worker、
// Tauri 原生进程或远程 FastAPI。
export class EngineAdapter {
  constructor(kind) {
    this.kind = kind;
  }

  async ready() {
    return true;
  }

  async evaluate(_fen, _options = {}) {
    throw new Error(`${this.kind} 引擎尚未实现局面评估`);
  }

  async dispose() {}
}

