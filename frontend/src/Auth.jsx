import React from "react";
import { login, register } from "./api";

// 登录 / 注册弹窗。成功后回调 onAuth({token, username, role})。
export default function Auth({ onClose, onAuth }) {
  const [mode, setMode] = React.useState("login"); // login | register
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const fn = mode === "login" ? login : register;
      const res = await fn(username.trim(), password);
      onAuth(res);
    } catch (err) {
      setError(err.message || "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <input
            className="import-input"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            className="import-input"
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="import-error">{error}</div>}
          <button className="btn-start" type="submit" disabled={busy}>
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
          </button>
          {mode === "register" && (
            <p className="muted" style={{ fontSize: 12 }}>
              首位注册用户将成为管理员。
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
