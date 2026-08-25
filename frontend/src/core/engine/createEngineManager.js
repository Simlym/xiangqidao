import { EngineManager } from "./EngineManager";
import { RemoteEngineAdapter } from "./RemoteEngineAdapter";
import { TauriEngineAdapter } from "./TauriEngineAdapter";
import { WasmEngineAdapter } from "./WasmEngineAdapter";

export function createEngineManager({ remoteEvaluate }) {
  return new EngineManager([
    new TauriEngineAdapter(),
    new WasmEngineAdapter(),
    new RemoteEngineAdapter(remoteEvaluate),
  ]);
}
