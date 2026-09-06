import React from "react";
import {
  getNativeEngineProfile,
  saveNativeEngineProfile,
} from "../../domain/xiangqi/engine/TauriEngineAdapter";
import { runtime, supportsNativeEngine } from "../../platform/runtime";

export default function NativeEngineSettings({
  manager,
  onReady,
  variant = "xiangqi",
  label = "标准象棋 UCI 引擎",
}) {
  const sourceUrl = variant === "jieqi"
    ? "https://github.com/official-pikafish/Pikafish/branches"
    : "https://github.com/official-pikafish/Pikafish/releases";
  const initial = React.useMemo(() => getNativeEngineProfile(variant), [variant]);
  const [path, setPath] = React.useState(() => initial?.path || "");
  const [threads, setThreads] = React.useState(() => initial?.threads || 2);
  const [hashMb, setHashMb] = React.useState(() => initial?.hashMb || 256);
  const [checking, setChecking] = React.useState(false);
  const [statuses, setStatuses] = React.useState(null);
  const [platform, setPlatform] = React.useState(null);

  React.useEffect(() => {
    if (!supportsNativeEngine(runtime)) return;
    import("@tauri-apps/api/core").then(({ invoke }) => invoke("platform_info")).then(setPlatform).catch(() => {});
  }, []);

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
        : { ok: true, text: "未发现独立 NNUE 文件；若该引擎不需要或已内置权重，可正常使用" },
    });
    return result;
  }

  async function choosePath(directory) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open(directory
      ? { directory: true, multiple: false, title: "选择 UCI 引擎所在目录" }
      : { directory: false, multiple: false, title: "选择 UCI 引擎程序", filters: [{ name: "UCI 引擎程序", extensions: ["exe", "bin", "appimage"] }] });
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
      setStatuses({ program: { ok: false, text: "请先选择 UCI 引擎程序或所在目录" }, nnue: null });
      return;
    }
    setChecking(true);
    try {
      const inspected = await inspectPath(normalized);
      if (!inspected.enginePath) return;
      saveNativeEngineProfile({ path: inspected.enginePath, nnuePath: inspected.nnuePath || null, args: [], threads, hashMb }, variant);
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
        nnue: inspected.nnuePath
          ? { ok: ready, text: `${ready ? "资源文件已发现" : "资源文件已找到，但引擎启动失败"}：${inspected.nnuePath}` }
          : { ok: true, text: "该引擎未使用独立 NNUE，或权重已内置" },
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
        选择用户自行下载的{label}程序或所在目录。象棋道只通过 UCI 协议调用，不提供引擎文件。
        {variant === "jieqi" && " 必须使用支持揭棋暗子局面的专用引擎，不能复用普通标准象棋引擎。"}
      </p>
      {platform && <p className="muted" style={{ fontSize: 12 }}>
        本机：{platform.os} / {platform.arch} · {platform.cpuCount} 线程
        {platform.features?.length ? ` · ${platform.features.join(" / ")}` : ""}
      </p>}
      <p className="muted" style={{ fontSize: 12 }}>
        <a href={sourceUrl} target="_blank" rel="noreferrer">根据上述平台信息查看推荐上游页面</a>
        。项目不代理下载；程序与权重许可需分别确认。
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
