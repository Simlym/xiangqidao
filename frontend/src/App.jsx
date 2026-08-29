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
import { fetchMe, getToken, setToken, getCredits, checkinCredits, getEntitlements } from "./api";
import { useReminders } from "./reminders";
import { RUNTIME, runtime } from "./platform/runtime";

const TAB_DESCRIPTIONS = {
  train: "今日计划与专项训练",
  coach: "个性化棋力建议",
  challenge: "循序渐进提升棋力",
  stats: "训练记录与能力变化",
  games: "查看棋谱并分析得失",
  play: "与本地或云端引擎对弈",
  jieqi: "揭棋人机对弈",
  admin: "用户、权益与系统配置",
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
  const isDesktop = runtime === RUNTIME.TAURI;
  const [tab, setTab] = React.useState("train");
  // 训练目标：null | {puzzleId} | {category}，用于从复盘/弱点跳转到指定练习
  const [trainTarget, setTrainTarget] = React.useState(null);
  // 复盘目标：从对弈结束「一键复盘」跳转时携带的棋局 id
  const [reviewGameId, setReviewGameId] = React.useState(null);
  const [user, setUser] = React.useState(null); // {username, role}
  const [credits, setCredits] = React.useState(null); // {balance, checkin_today, costs, ...}
  const [entitlements, setEntitlements] = React.useState(null);
  const [authOpen, setAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState("login");

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
    if (tab === "admin" || tab === "coach") setTab("train");
  }

  // 登录态失效（如收到 401）时，清理并弹出登录框
  function requireLogin() {
    openAuth("login");
  }

  const tabs = [
    { key: "train", icon: "🎯", desktopIcon: "◎", label: "战术训练", short: "训练" },
    ...(entitlements?.features?.includes("ai_training")
      ? [{ key: "coach", icon: "🧑‍🏫", desktopIcon: "✦", label: "AI 教练", short: "教练" }]
      : []),
    { key: "challenge", icon: "🏯", desktopIcon: "◇", label: "闯关", short: "闯关" },
    { key: "stats", icon: "📊", desktopIcon: "▥", label: "进度统计", short: "统计" },
    { key: "games", icon: "📋", desktopIcon: "≡", label: "棋局复盘", short: "复盘" },
    { key: "play", icon: "♟️", desktopIcon: "♟", label: "人机对弈", short: "对弈" },
    { key: "jieqi", icon: "◉", desktopIcon: "◉", label: "揭棋", short: "揭棋" },
    ...(user?.role === "admin"
      ? [{ key: "admin", icon: "⚙️", desktopIcon: "⚙", label: "管理后台", short: "后台" }]
      : []),
  ];

  const activeTab = tabs.find((item) => item.key === tab) || tabs[0];

  const nav = (
    <nav aria-label="主要功能">
      {tabs.map((item) => (
        <button
          key={item.key}
          className={tab === item.key ? "active" : ""}
          onClick={() => setTab(item.key)}
          title={isDesktop ? undefined : item.label}
        >
          <span className="nav-ico" aria-hidden>{isDesktop ? item.desktopIcon : item.icon}</span>
          <span className="nav-label-full">{item.label}</span>
          <span className="nav-label-short">{item.short}</span>
        </button>
      ))}
    </nav>
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
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
        />
      )}
      {tab === "challenge" && <Challenge />}
      {tab === "stats" && <Stats onPractice={practiceCategory} />}
      {tab === "play" && (
        <Play
          onGoReview={reviewGame}
          user={user}
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
        />
      )}
      {tab === "jieqi" && <JieqiPlay />}
      {tab === "admin" && user?.role === "admin" && <Admin />}
      {tab === "games" && (
        <Games
          initialGameId={reviewGameId}
          onInitialGameConsumed={() => setReviewGameId(null)}
          onNavigateToTrain={practicePuzzle}
          user={user}
          onCreditsChanged={refreshCredits}
          onRequireLogin={requireLogin}
        />
      )}
    </>
  );

  return (
    <div className={`app ${isDesktop ? "app-desktop" : "app-web"}`}>
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
              <div className="desktop-account-head">
                <span className="desktop-avatar">{user?.username?.slice(0, 1) || "棋"}</span>
                <span>
                  <strong>{user?.username || "游客模式"}</strong>
                  <small>{entitlements?.active ? "PRO 会员" : user ? "普通用户" : "登录后同步进度"}</small>
                </span>
              </div>
              <div className="desktop-account-actions">{account}</div>
            </div>
          </aside>
          <section className="desktop-workspace">
            <header className="desktop-toolbar">
              <div>
                <h1>{activeTab.label}</h1>
                <p>{TAB_DESCRIPTIONS[activeTab.key]}</p>
              </div>
              <span className="desktop-runtime-badge"><i />PC 客户端</span>
            </header>
            {reminderBanner}
            <main>{pageContent}</main>
            <footer className="desktop-statusbar">
              <span>桌面模式</span>
              <span className="desktop-status-spacer" />
              <span>{activeTab.label}</span>
            </footer>
          </section>
        </>
      ) : (
        <>
          <header className="web-header">
            <h1>象棋道</h1>
            {nav}
            <div className="user-box">{account}</div>
          </header>
          {reminderBanner}
          <main>{pageContent}</main>
        </>
      )}
      {authOpen && (
        <Auth initialMode={authMode} onClose={() => setAuthOpen(false)} onAuth={onAuth} />
      )}
    </div>
  );
}
