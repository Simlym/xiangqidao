import { EngineManager } from "./EngineManager";
import { RemoteEngineAdapter } from "./RemoteEngineAdapter";
import { TauriEngineAdapter } from "./TauriEngineAdapter";
import { WasmEngineAdapter } from "./WasmEngineAdapter";

export function createEngineManager({ remoteEvaluate, variant = "xiangqi" }) {
  return new EngineManager([
    new TauriEngineAdapter(variant),
    new WasmEngineAdapter(variant),
    new RemoteEngineAdapter(remoteEvaluate),
  ]);
}
