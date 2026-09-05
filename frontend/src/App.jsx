import React from "react";
import Trainer from "./Trainer";
import Coach from "./Coach";
import Stats from "./Stats";
import Games from "./Games";
import Play from "./Play";
import JieqiPlay from "./JieqiPlay";
import Challenge from "./Challenge";
import Auth from "./Auth";
import Admin from "./Admin";
import Settings from "./Settings";
import Today from "./Today";
import Learning from "./Learning";
import { API_BASE_URL, fetchMe, getToken, setToken, resetGuestId, getCredits, checkinCredits, getEntitlements } from "./api";
import { useReminders } from "./reminders";
import { runtime, usesDesktopLayout } from "./platform/runtime";
import { useCosmeticPreferences } from "./cosmetics";

const TAB_DESCRIPTIONS = {
  today: "今日任务与下一步行动",
  train: "今日计划与专项训练",
  coach: "个性化棋力建议",
  challenge: "循序渐进提升棋力",
  stats: "训练记录与能力变化",
  games: "查看棋谱并分析得失",
  play: "与本地或云端引擎对弈",
  jieqi: "揭棋对弈",
  admin: "当前 Web 服务的用户、内容与云端配置",
  settings: "应用偏好与本地引擎配置",
};

// 顶部积分徽标 + 每日签到。积分用于兑换 AI（大模型）功能权益。
function CreditsBadge({ credits, onCheckin }) {
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState("");
  if (!credits) return null;

  async function doCheckin() {
    if (busy || credits.checkin_today) return;
    setBusy(true);
    try {
      const r = await checkinCredits();
      if (r.awarded > 0) {
        setToast(`签到 +${r.awarded} 积分${r.streak > 1 ? `（连签 ${r.streak} 天）` : ""}`);
        setTimeout(() => setToast(""), 2600);
      }
      onCheckin();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="credits-box">
      <span className="credits-amt" title="积分：用于兑换 AI 教练等大模型功能">
        💎 {credits.balance}
      </span>
      <button
        className="btn-link credits-checkin"
        onClick={doCheckin}
        disabled={busy || credits.checkin_today}
        title={credits.checkin_today ? "今日已签到" : "每日签到领积分"}
      >
        {credits.checkin_today ? "已签到" : busy ? "…" : "签到"}
      </button>
      {toast && <span className="credits-toast">{toast}</span>}
    </span>
  );
}

export default function App() {
  const isDesktop = usesDesktopLayout(runtime);
  const appearance = useCosmeticPreferences();
  const [tab, setTab] = React.useState("today");
  // 训练目标：null | {puzzleId} | {category}，用于从复盘/弱点跳转到指定练习
  const [trainTarget, setTrainTarget] = React.useState(null);
  // 复盘目标：从对弈结束「一键复盘」跳转时携带的棋局 id
  const [reviewGameId, setReviewGameId] = React.useState(null);
  const [user, setUser] = React.useState(null); // {username, role}
  const [credits, setCredits] = React.useState(null); // {balance, checkin_today, costs, ...}
  const [entitlements, setEntitlements] = React.useState(null);
  const [authOpen, setAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState("login");
  const desktopUserMenuRef = React.useRef(null);

  function openAuth(mode = "login") {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  // 拉取积分余额；登录态下调用，未登录清空
  const refreshCredits = React.useCallback(() => {
    if (!getToken()) {
      setCredits(null);
      return;
    }
    getCredits().then(setCredits).catch(() => {});
  }, []);
  const refreshEntitlements = React.useCallback(() => {
    if (!getToken()) {
      setEntitlements(null);
      return;
    }
    getEntitlements().then(setEntitlements).catch(() => setEntitlements(null));
  }, []);
  // 到期复习提醒（本地通知 + 顶部横幅）
  const reminders = useReminders(user);

  React.useEffect(() => {
    document.body.classList.toggle("desktop-runtime", isDesktop);
    return () => document.body.classList.remove("desktop-runtime");
  }, [isDesktop]);

  React.useEffect(() => {
    document.body.dataset.appTheme = appearance.app;
    return () => { delete document.body.dataset.appTheme; };
  }, [appearance.app]);

  React.useEffect(() => {
    function closeUserMenu(event) {
      const menu = desktopUserMenuRef.current;
      if (menu?.open && !menu.contains(event.target)) menu.removeAttribute("open");
    }
    function closeUserMenuOnEscape(event) {
      if (event.key === "Escape") desktopUserMenuRef.current?.removeAttribute("open");
    }
    document.addEventListener("pointerdown", closeUserMenu);
    document.addEventListener("keydown", closeUserMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeUserMenu);
      document.removeEventListener("keydown", closeUserMenuOnEscape);
    };
  }, []);

  // 跳到训练并指定要练的题/类目
  function practicePuzzle(puzzleId) {
    setTrainTarget({ puzzleId });
    setTab("train");
  }
  function practiceCategory(category) {
    setTrainTarget({ category });
    setTab("train");
  }
  // 跳到复盘并打开指定棋局
  function reviewGame(gameId) {
    setReviewGameId(gameId);
    setTab("games");
  }

  // 启动时若有 token，拉取当前用户与积分
  React.useEffect(() => {
    if (getToken()) {
      fetchMe()
        .then((u) => {
          setUser(u);
          refreshCredits();
          refreshEntitlements();
        })
        .catch(() => setToken(null));
    }
  }, [refreshCredits, refreshEntitlements]);

  function onAuth(res) {
    setToken(res.token);
    resetGuestId();
    setUser({ username: res.username, role: res.role });
    setAuthOpen(false);
    refreshCredits();
    refreshEntitlements();
  }

  function logout() {
    setToken(null);
    setUser(null);
    setCredits(null);
    setEntitlements(null);
    if (tab === "admin") setTab("today");
  }

  // 登录态失效（如收到 401）时，清理并弹出登录框
  function requireLogin() {
    openAuth("login");
  }
  function practiceScope(scope) {
    setTrainTarget(scope);
    setTab("train");
  }
  function startPack(pack) {
    setTrainTarget({ packId: pack.id, packType: pack.type, title: pack.title, puzzleIds: pack.puzzle_ids });
    setTab("train");
  }

  const primaryGroups = [
    { key: "today", icon: "◷", label: "今日", short: "今日", defaultTab: "today", tabs: ["today", "stats", "coach"] },
    { key: "training", icon: "◎", label: "训练", short: "训练", defaultTab: "train", tabs: ["train", "learning", "challenge"] },
    { key: "playing", icon: "♟", label: "对弈", short: "对弈", defaultTab: "play", tabs: ["play", "jieqi"] },
    { key: "records", icon: "≡", label: "棋谱", short: "棋谱", defaultTab: "games", tabs: ["games"] },
  ];
  const pageTabs = [
    { key: "today", label: "今日计划" },
    { key: "stats", label: "成长报告" },
    { key: "coach", label: "教练建议" },
    { key: "train", label: "每日训练" },
    { key: "learning", label: "学习地图与测评" },
    { key: "challenge", label: "闯关" },
    { key: "play", label: "标准象棋" },
    { key: "jieqi", label: "揭棋" },
    { key: "games", label: "我的棋局" },
  ];
  const settingsTab = { key: "settings", icon: "⚙️", desktopIcon: "⚙", label: isDesktop ? "本机设置" : "设置", short: "设置" };
  const adminTab = { key: "admin", icon: "◎", desktopIcon: "◎", label: isDesktop ? "Web 管理后台" : "管理后台", short: "后台" };
  const utilityTabs = [settingsTab, ...(user?.role === "admin" ? [adminTab] : [])];
  const activeGroup = primaryGroups.find((group) => group.tabs.includes(tab));
  const activeTab = [...pageTabs, ...utilityTabs].find((item) => item.key === tab) || pageTabs[0];

  const nav = (
    <nav aria-label="主要功能">
      {primaryGroups.map((item) => (
        <button
          key={item.key}
          className={item.tabs.includes(tab) ? "active" : ""}
          onClick={() => setTab(item.defaultTab)}
          title={isDesktop ? undefined : item.label}
        >
          <span className="nav-ico" aria-hidden>{item.icon}</span>
          <span className="nav-label-full">{item.label}</span>
          <span className="nav-label-short">{item.short}</span>
        </button>
      ))}
    </nav>
  );

  const secondaryNav = activeGroup && activeGroup.tabs.length > 1 && (
    <div className="section-tabs" role="tablist" aria-label={`${activeGroup.label}二级导航`}>
      {pageTabs.filter((item) => activeGroup.tabs.includes(item.key)).map((item) => (
        <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  );

  const account = user ? (
    <>
      <CreditsBadge credits={credits} onCheckin={refreshCredits} />
      {entitlements?.active && <span className="member-badge">PRO</span>}
      <span className="user-name">{user.username}</span>
      <button className="btn-link" onClick={logout}>退出</button>
    </>
  ) : (
    <>
      <button className="btn-link" onClick={() => openAuth("login")}>登录</button>
      <button className="btn-link btn-register" onClick={() => openAuth("register")}>免费注册</button>
    </>
  );

  const desktopAccount = user ? (
    <details className="desktop-user-menu" ref={desktopUserMenuRef}>
      <summary>
        <span className="desktop-avatar">{user.username?.slice(0, 1) || "棋"}</span>
        <span className="desktop-user-summary">
          <strong>{user.username}</strong>
          <small>
            {credits ? `💎 ${credits.balance}${credits.checkin_today ? " · 今日已签到" : " · 今日未签到"}` : "账户已登录"}
          </small>
        </span>
        <span className="desktop-user-arrow" aria-hidden>›</span>
      </summary>
      <div className="desktop-user-popover">
        <div className="desktop-user-popover-head">
          <strong>{user.username}</strong>
          {entitlements?.active && <span className="member-badge">PRO</span>}
        </div>
        <CreditsBadge credits={credits} onCheckin={refreshCredits} />
        <button className="desktop-logout" onClick={logout}>退出登录</button>
      </div>
    </details>
  ) : (
    <div className="desktop-guest-account">
      <span className="desktop-avatar">棋</span>
      <div>
        <strong>游客模式</strong>
        <small>登录后同步训练进度</small>
      </div>
      <button onClick={() => openAuth("login")}>登录</button>
    </div>
  );

  const reminderBanner = reminders.banner && (
    <div className="reminder-banner">
      <span>{reminders.banner}</span>
      <button className="btn-link" onClick={() => setTab("train")}>去复习 →</button>
      {reminders.canEnable && (
        <button className="btn-link" onClick={reminders.enable}>开启提醒</button>
      )}
      <button className="reminder-x" onClick={reminders.dismiss}>×</button>
    </div>
  );

  const pageContent = (
    <>
      {tab === "today" && (
        <Today user={user} onNavigate={setTab} onPractice={practiceCategory} />
      )}
      {tab === "train" && (
        <Trainer
          target={trainTarget}
          onTargetConsumed={() => setTrainTarget(null)}
          user={user}
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
        />
      )}
      {tab === "coach" && (
        <Coach
          onPractice={practiceCategory}
          onNavigate={setTab}
          user={user}
          credits={credits}
          entitlements={entitlements}
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
        />
      )}
      {tab === "challenge" && <Challenge />}
      {tab === "learning" && <Learning onPractice={practiceScope} onStartPack={startPack} />}
      {tab === "stats" && <Stats onPractice={practiceCategory} />}
      {tab === "play" && (
        <Play
          onGoReview={reviewGame}
          user={user}
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
          onOpenSettings={isDesktop ? () => setTab("settings") : null}
        />
      )}
      {tab === "jieqi" && (
        <JieqiPlay onOpenSettings={isDesktop ? () => setTab("settings") : null} />
      )}
      {tab === "admin" && user?.role === "admin" && (
        <Admin desktop={isDesktop} serviceUrl={API_BASE_URL} />
      )}
      {tab === "settings" && (
        <Settings
          user={user}
          credits={credits}
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
        />
      )}
      {tab === "games" && (
        <Games
          initialGameId={reviewGameId}
          onInitialGameConsumed={() => setReviewGameId(null)}
          onNavigateToTrain={practicePuzzle}
          onStartPack={startPack}
          user={user}
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
        />
      )}
    </>
  );

  return (
    <div className={`app app-theme-${appearance.app} ${appearance.app !== "classic" ? "app-theme-custom" : ""} ${isDesktop ? "app-desktop" : "app-web"}`}>
      {isDesktop ? (
        <>
          <aside className="desktop-sidebar">
            <div className="desktop-brand">
              <span className="desktop-brand-mark">象</span>
              <span>
                <strong>象棋道</strong>
                <small>XIANGQI DAO</small>
              </span>
            </div>
            <span className="desktop-nav-caption">主要功能</span>
            {nav}
            <div className="desktop-account">
              <button
                className={`desktop-settings-link${tab === "settings" ? " active" : ""}`}
                onClick={() => setTab("settings")}
              >
                <span className="desktop-settings-icon" aria-hidden>⚙</span>
                <span>本机设置</span>
              </button>
              {user?.role === "admin" && (
                <button
                  className={`desktop-settings-link${tab === "admin" ? " active" : ""}`}
                  onClick={() => setTab("admin")}
                >
                  <span className="desktop-settings-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" focusable="false">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21M12 3C9.6 5.5 8.4 8.5 8.4 12s1.2 6.5 3.6 9" />
                    </svg>
                  </span>
                  <span>Web 管理后台</span>
                </button>
              )}
              {desktopAccount}
            </div>
          </aside>
          <section className={`desktop-workspace desktop-tab-${tab}`}>
            <header className="desktop-toolbar">
              <div>
                <h1>{activeGroup?.label || activeTab.label}</h1>
                <p>{TAB_DESCRIPTIONS[activeTab.key]}</p>
              </div>
              <span className="desktop-runtime-badge"><i />PC 客户端</span>
            </header>
            {reminderBanner}
            {secondaryNav}
            <main>{pageContent}</main>
            <footer className="desktop-statusbar">
              <span>桌面模式</span>
              <span className="desktop-status-spacer" />
              <span>{activeGroup?.label || activeTab.label}</span>
            </footer>
          </section>
        </>
      ) : (
        <>
          <header className="web-header">
            <div className="web-brand" aria-label="象棋道首页">
              <span className="web-brand-mark" aria-hidden>象</span>
              <span className="web-brand-copy">
                <h1>象棋道</h1>
                <small>XIANGQI DAO</small>
              </span>
            </div>
            {nav}
            <div className="user-box">
              <button className="btn-link" onClick={() => setTab("settings")}>设置</button>
              {user?.role === "admin" && <button className="btn-link" onClick={() => setTab("admin")}>后台</button>}
              {account}
            </div>
          </header>
          {reminderBanner}
          {secondaryNav}
          <main>{pageContent}</main>
        </>
      )}
      {authOpen && (
        <Auth initialMode={authMode} onClose={() => setAuthOpen(false)} onAuth={onAuth} />
      )}
    </div>
  );
}
