import React from "react";
import {
  getNativeEngineProfile,
  saveNativeEngineProfile,
} from "../core/engine/TauriEngineAdapter";
import { runtime, supportsNativeEngine } from "../platform/runtime";

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
  const [statuses, setStatuses] = React.useState(null);

  if (!supportsNativeEngine(runtime)) return null;

  async function inspectPath(selectedPath) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("inspect_engine_path", { path: selectedPath });
    if (result.enginePath) setPath(result.enginePath);
    setStatuses({
      program: result.enginePath
        ? { ok: true, text: `程序已找到：${result.enginePath}` }
        : { ok: false, text: "未在所选目录中找到可执行程序（Windows 下为 .exe 文件）" },
      nnue: result.nnuePath
        ? { ok: true, text: `NNUE 已找到：${result.nnuePath}` }
        : { ok: false, text: "未找到 NNUE 权重文件，请将 .nnue 文件放在程序同一目录" },
    });
    return result;
  }

  async function choosePath(directory) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open(directory
      ? { directory: true, multiple: false, title: "选择 Pikafish 所在目录" }
      : { directory: false, multiple: false, title: "选择 Pikafish 程序", filters: [{ name: "Pikafish 程序", extensions: ["exe", "bin", "appimage"] }] });
    if (!selected) return;
    try {
      await inspectPath(selected);
    } catch (error) {
      setStatuses({ program: { ok: false, text: String(error) }, nnue: null });
    }
  }

  async function saveAndCheck() {
    const normalized = path.trim();
    if (!normalized) {
      setStatuses({ program: { ok: false, text: "请先选择 Pikafish 程序或所在目录" }, nnue: null });
      return;
    }
    setChecking(true);
    try {
      const inspected = await inspectPath(normalized);
      if (!inspected.enginePath || !inspected.nnuePath) return;
      saveNativeEngineProfile({ path: inspected.enginePath, args: [], threads, hashMb }, variant);
      // 强制关闭旧进程，确保检测的是用户刚刚选中的程序，而不是上一次已启动的实例。
      await manager.dispose();
      const kinds = await manager.availableKinds();
      const ready = kinds.includes("native");
      const detail = manager.errorFor?.("native");
      setStatuses((current) => ({
        ...current,
        program: ready
          ? { ok: true, text: `程序加载成功：${inspected.enginePath}` }
          : { ok: false, text: `程序加载失败，将自动使用云端引擎${detail ? `：${detail}` : ""}` },
        nnue: ready
          ? { ok: true, text: `NNUE 加载成功：${inspected.nnuePath}` }
          : { ok: false, text: `NNUE 文件已找到，但引擎未能完成加载：${inspected.nnuePath}` },
      }));
      onReady?.(ready, ready ? "native" : null);
    } catch (error) {
      setStatuses({ program: { ok: false, text: String(error) }, nnue: null });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="native-engine-settings">
      <strong>PC 本地分析引擎</strong>
      <p className="muted">
        选择{label}程序，或选择同时包含程序与 NNUE 的目录。
        {variant === "jieqi" && " 必须使用支持揭棋暗子局面的专用构建，不能复用标准象棋官方版。"}
      </p>
      <div className="native-engine-input">
        <input
          value={path}
          readOnly
          placeholder="尚未选择程序"
          spellCheck={false}
        />
        <button type="button" onClick={() => choosePath(false)} disabled={checking}>选择程序</button>
        <button type="button" onClick={() => choosePath(true)} disabled={checking}>选择目录</button>
        <button onClick={saveAndCheck} disabled={checking}>
          {checking ? "检测中…" : "保存并检测"}
        </button>
      </div>
      <div className="native-engine-limits">
        <label>线程 <input type="number" min="1" max="8" value={threads} onChange={(event) => setThreads(Number(event.target.value))} /></label>
        <label>哈希内存(MB) <input type="number" min="32" max="2048" step="32" value={hashMb} onChange={(event) => setHashMb(Number(event.target.value))} /></label>
        <span className="muted">建议保留一半 CPU 给界面和系统</span>
      </div>
      {statuses && <div className="native-engine-statuses" aria-live="polite">
        {statuses.program && <div className={statuses.program.ok ? "engine-status-ok" : "engine-status-error"}>
          <strong>{statuses.program.ok ? "✓ 程序" : "✕ 程序"}</strong><span>{statuses.program.text}</span>
        </div>}
        {statuses.nnue && <div className={statuses.nnue.ok ? "engine-status-ok" : "engine-status-error"}>
          <strong>{statuses.nnue.ok ? "✓ NNUE" : "✕ NNUE"}</strong><span>{statuses.nnue.text}</span>
        </div>}
      </div>}
    </div>
  );
}
