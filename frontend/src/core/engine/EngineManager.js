// 按优先级选择引擎，并在本地运行时失败后自动降级到 FastAPI。
// 后续 TauriEngineAdapter 只需插入 adapters 数组首位，无需修改业务页面。
export class EngineManager {
  constructor(adapters) {
    this.adapters = adapters.filter(Boolean);
  }

  async availableKinds() {
    const checks = await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          return (await adapter.ready()) ? adapter.kind : null;
        } catch {
          return null;
        }
      }),
    );
    return checks.filter(Boolean);
  }

  async evaluate(fen, options = {}, policy = {}) {
    let lastError;
    const adapters = policy.onlyKinds
      ? this.adapters.filter((adapter) => policy.onlyKinds.includes(adapter.kind))
      : this.adapters;
    for (const adapter of adapters) {
      try {
        if (!(await adapter.ready())) continue;
        const result = await adapter.evaluate(fen, options);
        return { ...result, runtime: adapter.kind };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("没有可用的分析引擎");
  }

  async dispose() {
    await Promise.allSettled(this.adapters.map((adapter) => adapter.dispose()));
  }
}
