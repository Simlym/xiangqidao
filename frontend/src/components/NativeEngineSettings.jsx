import React from "react";
import {
  getNativeEngineProfile,
  saveNativeEngineProfile,
} from "../core/engine/TauriEngineAdapter";
import { RUNTIME, runtime } from "../platform/runtime";

export default function NativeEngineSettings({
  manager,
  onReady,
  variant = "xiangqi",
  label = "标准象棋 Pikafish",
}) {
  const [path, setPath] = React.useState(() => getNativeEngineProfile(variant)?.path || "");
  const [checking, setChecking] = React.useState(false);
  const [message, setMessage] = React.useState("");

  if (runtime !== RUNTIME.TAURI) return null;

  async function saveAndCheck() {
    const normalized = path.trim();
    if (!normalized) {
      setMessage("请输入 Pikafish 可执行文件的绝对路径");
      return;
    }
    saveNativeEngineProfile({ path: normalized, args: [] }, variant);
    setChecking(true);
    setMessage("");
    try {
      const kinds = await manager.availableKinds();
      const ready = kinds.includes("native");
      setMessage(ready ? "原生引擎连接成功" : "原生引擎启动失败，将自动使用云端引擎");
      onReady?.(ready, ready ? "native" : null);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="native-engine-settings">
      <strong>PC 本地分析引擎</strong>
      <p className="muted">填写{label}的绝对路径；NNUE 请与程序放在同一目录。</p>
      <div className="native-engine-input">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="例如 D:\\engines\\pikafish.exe"
          spellCheck={false}
        />
        <button onClick={saveAndCheck} disabled={checking}>
          {checking ? "检测中…" : "保存并检测"}
        </button>
      </div>
      {message && <div className={message.includes("成功") ? "import-ok" : "import-error"}>{message}</div>}
    </div>
  );
}

