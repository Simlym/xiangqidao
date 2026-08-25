import { EngineAdapter } from "./EngineAdapter";

// 云端引擎适配器。请求函数由 API 层注入，避免核心层反向依赖具体接口文件。
export class RemoteEngineAdapter extends EngineAdapter {
  constructor(evaluatePosition) {
    super("remote");
    this.evaluatePosition = evaluatePosition;
  }

  evaluate(fen, options) {
    return this.evaluatePosition(fen, options);
  }
}

