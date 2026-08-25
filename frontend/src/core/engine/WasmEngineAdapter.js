import { EngineAdapter } from "./EngineAdapter";
import { localEngineReady, localEval } from "../../localEngine";

// 浏览器端 Pikafish WASM。计算在 Worker 中完成，不阻塞 React UI 线程。
export class WasmEngineAdapter extends EngineAdapter {
  constructor(variant = "xiangqi") {
    super("wasm");
    this.variant = variant;
  }

  ready() {
    return localEngineReady(this.variant);
  }

  evaluate(fen, options) {
    return localEval(fen, { ...options, variant: this.variant });
  }
}
