import React from "react";
import { login, register } from "./api";

// 登录 / 注册弹窗。成功后回调 onAuth({token, username, role})。
export default function Auth({ initialMode = "login", onClose, onAuth }) {
  const [mode, setMode] = React.useState(initialMode); // login | register
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);

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

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");
  }

  function requestClose() {
    if (busy) return;
    setCloseConfirmOpen(true);
  }

  return (
    <div
      className="modal-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className="modal auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "登录" : "注册账号"}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close auth-close" type="button" aria-label="关闭" onClick={requestClose}>×</button>
        <h2>{mode === "login" ? "欢迎回来" : "创建账号"}</h2>
        <p className="auth-intro">
          {mode === "login" ? "登录后同步你的训练进度和棋局。" : "注册后即可保存个人训练进度和棋局。"}
        </p>
        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => switchMode("register")}
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
            autoComplete="username"
            minLength={2}
            maxLength={40}
            required
            autoFocus
          />
          <input
            className="import-input"
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            maxLength={128}
            required
          />
          {error && <div className="import-error">{error}</div>}
          <button className="btn-start" type="submit" disabled={busy}>
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
          </button>
          {mode === "register" && (
            <p className="muted auth-note">
              用户名至少 2 位，密码至少 8 位。首位注册用户将成为管理员。
            </p>
          )}
        </form>
        {closeConfirmOpen && (
          <div className="auth-close-confirm" role="alertdialog" aria-modal="true" aria-labelledby="auth-close-title">
            <div className="auth-close-confirm-card">
              <h3 id="auth-close-title">确定关闭{mode === "login" ? "登录" : "注册"}窗口？</h3>
              <p>{username || password ? "已填写的内容将不会保留。" : "关闭后可随时重新打开。"}</p>
              <div className="auth-close-confirm-actions">
                <button type="button" onClick={() => setCloseConfirmOpen(false)}>继续{mode === "login" ? "登录" : "注册"}</button>
                <button type="button" className="danger" onClick={onClose}>确认关闭</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
