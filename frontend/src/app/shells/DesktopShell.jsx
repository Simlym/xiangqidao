import React from "react";

import { TAB_DESCRIPTIONS } from "../navigation";

export default function DesktopShell({
  tab, activeGroup, activeTab, navigation, secondaryNavigation,
  reminderBanner, account, children, onNavigate,
}) {
  const title = activeGroup?.label || activeTab.label;
  return (
    <>
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <span className="desktop-brand-mark">象</span>
          <span><strong>象棋道</strong><small>XIANGQI DAO</small></span>
        </div>
        <span className="desktop-nav-caption">主要功能</span>
        {navigation}
        <div className="desktop-account">
          <button className={`desktop-settings-link${tab === "settings" ? " active" : ""}`} onClick={() => onNavigate("settings")}>
            <span className="desktop-settings-icon" aria-hidden>⚙</span><span>设置</span>
          </button>
          {account}
        </div>
      </aside>
      <section className={`desktop-workspace desktop-tab-${tab}`}>
        <header className="desktop-toolbar">
          <div><h1>{title}</h1><p>{TAB_DESCRIPTIONS[activeTab.key]}</p></div>
          <span className="desktop-runtime-badge"><i />PC 客户端</span>
        </header>
        {reminderBanner}
        {secondaryNavigation}
        <main>{children}</main>
        <footer className="desktop-statusbar">
          <span>桌面模式</span><span className="desktop-status-spacer" /><span>{title}</span>
        </footer>
      </section>
    </>
  );
}
