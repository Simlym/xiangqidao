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

  errorFor(kind) {
    const adapter = this.adapters.find((item) => item.kind === kind);
    return adapter?.lastError ? String(adapter.lastError.message || adapter.lastError) : "";
  }

  async evaluate(fen, options = {}, policy = {}) {
    return this.startAnalysis(fen, options, policy).result;
  }

  startAnalysis(fen, options = {}, policy = {}) {
    let active = null;
    let stopped = false;
    let updateTimer = null;
    let pendingUpdate = null;
    let lastUpdateAt = 0;
    const deliverUpdate = () => {
      updateTimer = null;
      if (!pendingUpdate || stopped) return;
      const value = pendingUpdate;
      pendingUpdate = null;
      lastUpdateAt = Date.now();
      options.onUpdate?.(value);
    };
    const onUpdate = options.onUpdate ? (value) => {
      pendingUpdate = value;
      const remaining = 50 - (Date.now() - lastUpdateAt);
      if (remaining <= 0) deliverUpdate();
      else if (updateTimer == null) updateTimer = setTimeout(deliverUpdate, remaining);
    } : undefined;
    const adapters = policy.onlyKinds
      ? this.adapters.filter((adapter) => policy.onlyKinds.includes(adapter.kind))
      : this.adapters;
    const result = (async () => {
    let lastError;
    for (const adapter of adapters) {
      try {
        if (stopped) throw new DOMException("分析已停止", "AbortError");
        if (!(await adapter.ready())) continue;
        active = adapter.analyze(fen, { ...options, onUpdate });
        const value = await active.result;
        deliverUpdate();
        return { ...value, runtime: adapter.kind };
      } catch (error) {
        if (stopped || error?.name === "AbortError") throw error;
        lastError = error;
      }
    }
    throw lastError || new Error("没有可用的分析引擎");
    })();
    return {
      result,
      stop() {
        stopped = true;
        if (updateTimer != null) clearTimeout(updateTimer);
        active?.stop?.();
      },
    };
  }

  async dispose() {
    await Promise.allSettled(this.adapters.map((adapter) => adapter.dispose()));
  }

  getLog() {
    return this.adapters.flatMap((adapter) => adapter.getLog?.() || []).slice(-200);
  }
}
