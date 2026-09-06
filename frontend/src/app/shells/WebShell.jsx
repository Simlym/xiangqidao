import React from "react";

// Web 与 Android 共享响应式外壳；Android 的能力差异由 platform/runtime 和适配器处理。
export default function WebShell({ user, navigation, secondaryNavigation, reminderBanner, account, children, onNavigate }) {
  return (
    <>
      <header className="web-header">
        <div className="web-brand" aria-label="象棋道首页">
          <span className="web-brand-mark" aria-hidden>象</span>
          <span className="web-brand-copy"><h1>象棋道</h1><small>XIANGQI DAO</small></span>
        </div>
        {navigation}
        <div className="user-box">
          <button className="btn-link" onClick={() => onNavigate("settings")}>设置</button>
          {user?.role === "admin" && <button className="btn-link" onClick={() => onNavigate("admin")}>后台</button>}
          {account}
        </div>
      </header>
      {reminderBanner}
      {secondaryNavigation}
      <main>{children}</main>
    </>
  );
}
