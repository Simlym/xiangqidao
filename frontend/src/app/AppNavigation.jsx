import React from "react";

import { PAGE_TABS, PRIMARY_GROUPS } from "./navigation";

export function PrimaryNavigation({ tab, desktop, onNavigate }) {
  return (
    <nav aria-label="主要功能">
      {PRIMARY_GROUPS.map((item) => (
        <button
          key={item.key}
          className={item.tabs.includes(tab) ? "active" : ""}
          onClick={() => onNavigate(item.defaultTab)}
          title={desktop ? undefined : item.label}
        >
          <span className="nav-ico" aria-hidden>{item.icon}</span>
          <span className="nav-label-full">{item.label}</span>
          <span className="nav-label-short">{item.short}</span>
        </button>
      ))}
    </nav>
  );
}

export function SecondaryNavigation({ tab, activeGroup, onNavigate }) {
  if (!activeGroup || activeGroup.tabs.length <= 1) return null;
  return (
    <div className="section-tabs" role="tablist" aria-label={`${activeGroup.label}二级导航`}>
      {PAGE_TABS.filter((item) => activeGroup.tabs.includes(item.key)).map((item) => (
        <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => onNavigate(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
