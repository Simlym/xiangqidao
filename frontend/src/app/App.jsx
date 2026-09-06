import React from "react";
import Trainer from "../features/training/Trainer";
import Coach from "../features/coach/Coach";
import Stats from "../features/stats/Stats";
import Games from "../features/games/Games";
import Play from "../features/play/Play";
import JieqiPlay from "../features/jieqi/JieqiPlay";
import Challenge from "../features/challenge/Challenge";
import Auth from "../features/auth/Auth";
import Admin from "../features/admin/Admin";
import Settings from "../features/settings/Settings";
import Today from "../features/today/Today";
import Learning from "../features/learning/Learning";
import { API_BASE_URL, fetchMe, getToken, setToken, resetGuestId, getCredits, checkinCredits, getEntitlements } from "../shared/api";
import { useReminders } from "../features/today/useReminders";
import { runtime, usesDesktopLayout } from "../platform/runtime";
import { useCosmeticPreferences } from "../shared/preferences/cosmetics";
import { PrimaryNavigation, SecondaryNavigation } from "./AppNavigation";
import { resolveNavigation } from "./navigation";
import DesktopShell from "./shells/DesktopShell";
import WebShell from "./shells/WebShell";

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

  const { activeGroup, activeTab } = resolveNavigation(tab, {
    isDesktop,
    isAdmin: user?.role === "admin",
  });
  const navigation = <PrimaryNavigation tab={tab} desktop={isDesktop} onNavigate={setTab} />;
  const secondaryNavigation = <SecondaryNavigation tab={tab} activeGroup={activeGroup} onNavigate={setTab} />;

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
        <DesktopShell
          tab={tab} user={user} activeGroup={activeGroup} activeTab={activeTab}
          navigation={navigation} secondaryNavigation={secondaryNavigation}
          reminderBanner={reminderBanner} account={desktopAccount} onNavigate={setTab}
        >
          {pageContent}
        </DesktopShell>
      ) : (
        <WebShell
          user={user} navigation={navigation} secondaryNavigation={secondaryNavigation}
          reminderBanner={reminderBanner} account={account} onNavigate={setTab}
        >
          {pageContent}
        </WebShell>
      )}
      {authOpen && (
        <Auth initialMode={authMode} onClose={() => setAuthOpen(false)} onAuth={onAuth} />
      )}
    </div>
  );
}
