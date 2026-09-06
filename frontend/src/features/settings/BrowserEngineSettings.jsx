import React from "react";
import {
  browserEngineCapabilities,
  getBrowserEngineProfile,
  importBrowserEnginePackage,
  removeBrowserEnginePackage,
} from "../../domain/xiangqi/engine/browserEnginePackages";
import { resetLocalEngine } from "../../domain/xiangqi/engine/localEngine";

export default function BrowserEngineSettings({ manager, variant = "xiangqi" }) {
  const sourceUrl = variant === "jieqi"
    ? "https://github.com/official-pikafish/Pikafish/branches"
    : "https://github.com/official-pikafish/Pikafish/releases";
  const [profile, setProfile] = React.useState(() => getBrowserEngineProfile(variant));
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const capabilities = browserEngineCapabilities();

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
      setMessage("引擎包已保存在本设备。若当前页面尚未受本地存储服务控制，请刷新一次后检测。 ");
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
    setMessage("本设备上的引擎包已移除");
  }

  return <div className="native-engine-settings">
    <strong>本设备 WASM 引擎</strong>
    <p className="muted">
      象棋道不提供引擎文件。请自行下载并解压符合象棋道包规范的 WASM UCI 引擎，然后选择整个目录；文件只保存在当前设备。
    </p>
    <p className="muted" style={{ fontSize: 12 }}>
      <a href={sourceUrl} target="_blank" rel="noreferrer">查看上游项目页面</a>
      。上游原生版本不能直接用于浏览器；需要作者提供或用户自行编译为兼容的 WASM 引擎包。
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
    {profile && <div className="engine-status-ok"><strong>✓ 已导入</strong><span>{profile.name} {profile.version}</span></div>}
    {error && <div className="import-error">{error}</div>}
    {message && <div className="import-ok">{message}</div>}
  </div>;
}
