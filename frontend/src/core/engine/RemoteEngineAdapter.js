import { EngineAdapter } from "./EngineAdapter";

// 云端引擎适配器。请求函数由 API 层注入，避免核心层反向依赖具体接口文件。
export class RemoteEngineAdapter extends EngineAdapter {
  constructor(evaluatePosition, streamPosition = null) {
    super("remote");
    this.evaluatePosition = evaluatePosition;
    this.streamPosition = streamPosition;
  }

  evaluate(fen, options) {
    // 共享服务器不持续占用引擎做无限搜索；远程降级时以深度分析完成一次结果。
    const safeOptions = options?.mode === "infinite"
      ? { ...options, mode: "depth", value: options.depth || 20 }
      : options;
    return safeOptions?.onUpdate && this.streamPosition
      ? this.streamPosition(fen, safeOptions)
      : this.evaluatePosition(fen, safeOptions);
  }
}

