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
  const initial = React.useMemo(() => getNativeEngineProfile(variant), [variant]);
  const [path, setPath] = React.useState(() => initial?.path || "");
  const [threads, setThreads] = React.useState(() => initial?.threads || 2);
  const [hashMb, setHashMb] = React.useState(() => initial?.hashMb || 256);
  const [checking, setChecking] = React.useState(false);
  const [message, setMessage] = React.useState("");

  if (runtime !== RUNTIME.TAURI) return null;

  async function saveAndCheck() {
    const normalized = path.trim();
    if (!normalized) {
      setMessage("请输入 Pikafish 可执行文件的绝对路径");
      return;
    }
    saveNativeEngineProfile({ path: normalized, args: [], threads, hashMb }, variant);
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
      <div className="native-engine-limits">
        <label>线程 <input type="number" min="1" max="8" value={threads} onChange={(event) => setThreads(Number(event.target.value))} /></label>
        <label>哈希内存(MB) <input type="number" min="32" max="2048" step="32" value={hashMb} onChange={(event) => setHashMb(Number(event.target.value))} /></label>
        <span className="muted">建议保留一半 CPU 给界面和系统</span>
      </div>
      {message && <div className={message.includes("成功") ? "import-ok" : "import-error"}>{message}</div>}
    </div>
  );
}
