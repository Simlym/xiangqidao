import React from "react";
import {
  browserEngineCapabilities,
  getBrowserEngineProfile,
  importBrowserEnginePackage,
  removeBrowserEnginePackage,
} from "../../domain/xiangqi/engine/browserEnginePackages";
import { localEngineReady, resetLocalEngine } from "../../domain/xiangqi/engine/localEngine";

export default function BrowserEngineSettings({ manager, variant = "xiangqi" }) {
  const [profile, setProfile] = React.useState(() => getBrowserEngineProfile(variant));
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [engineReady, setEngineReady] = React.useState(null);
  const capabilities = browserEngineCapabilities();

  React.useEffect(() => {
    let active = true;
    if (!profile) {
      setEngineReady(null);
      return () => { active = false; };
    }
    localEngineReady(variant)
      .then((ready) => { if (active) setEngineReady(ready); })
      .catch(() => { if (active) setEngineReady(false); });
    return () => { active = false; };
  }, [profile, variant]);

  async function importFiles(event) {
    const files = event.target.files;
    if (!files?.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !capabilities.cacheStorage) {
        throw new Error("当前 WebView 不支持本地引擎包存储，请使用远程引擎或升级客户端");
      }
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const next = await importBrowserEnginePackage(files, variant);
      resetLocalEngine(variant);
      await manager.dispose();
      setProfile(next);
      setEngineReady(null);
      if (!navigator.serviceWorker.controller) {
        // 首次安装 Service Worker 时，当前页面未必能立刻通过虚拟路径读取引擎文件。
        // 刷新后由 Service Worker 接管，再由上面的 effect 做真实 UCI 握手检测。
        window.location.reload();
        return;
      }
      const ready = await localEngineReady(variant);
      setEngineReady(ready);
      if (ready) setMessage("本地 WASM 引擎已就绪，对弈和分析将优先使用本地引擎。");
      else setError("引擎包已保存，但启动或 UCI 握手失败；对弈将继续使用云端引擎。");
    } catch (reason) {
      setError(reason.message || String(reason));
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function remove() {
    await manager.dispose();
    resetLocalEngine(variant);
    await removeBrowserEnginePackage(variant);
    setProfile(null);
    setEngineReady(null);
    setMessage("本设备上的引擎包已移除");
  }

  return <div className="native-engine-settings">
    <strong>本设备 WASM 引擎</strong>
    <p className="muted">
      象棋道不提供引擎文件。请自行下载并解压符合象棋道包规范的 WASM UCI 引擎，然后选择整个目录；文件只保存在当前设备。
    </p>
    <p className="muted" style={{ fontSize: 12 }}>
      上游原生版本不能直接用于浏览器；需要作者提供或用户自行编译为兼容的 WASM 引擎包。
    </p>
    <div className="import-row" style={{ alignItems: "center" }}>
      <label className="btn-import-submit">
        {busy ? "导入中…" : profile ? "更换引擎包" : "选择引擎包目录"}
        <input type="file" webkitdirectory="" multiple hidden disabled={busy} onChange={importFiles} />
      </label>
      {profile && <button className="game-delete-btn" style={{ width: "auto", padding: "0 12px" }} onClick={remove}>移除</button>}
      <span className="muted" style={{ fontSize: 12 }}>
        WASM {capabilities.webAssembly ? "✓" : "✕"} · Worker {capabilities.worker ? "✓" : "✕"} · 多线程 {capabilities.threads ? "✓" : "不可用"}
      </span>
    </div>
    {profile && <div className={engineReady === false ? "import-error" : "engine-status-ok"}>
      <strong>{engineReady === true ? "✓ 已就绪" : engineReady === false ? "✕ 启动失败" : "正在检测…"}</strong>
      <span>{profile.name} {profile.version}</span>
    </div>}
    {error && <div className="import-error">{error}</div>}
    {message && <div className="import-ok">{message}</div>}
  </div>;
}
