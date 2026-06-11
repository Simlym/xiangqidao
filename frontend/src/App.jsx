import React from "react";
import Trainer from "./Trainer";
import Coach from "./Coach";
import Stats from "./Stats";
import Games from "./Games";
import Play from "./Play";
import Challenge from "./Challenge";
import Auth from "./Auth";
import Admin from "./Admin";
import { fetchMe, getToken, setToken, getCredits, checkinCredits } from "./api";
import { useReminders } from "./reminders";

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
  const [tab, setTab] = React.useState("train");
  // 训练目标：null | {puzzleId} | {category}，用于从复盘/弱点跳转到指定练习
  const [trainTarget, setTrainTarget] = React.useState(null);
  // 复盘目标：从对弈结束「一键复盘」跳转时携带的棋局 id
  const [reviewGameId, setReviewGameId] = React.useState(null);
  const [user, setUser] = React.useState(null); // {username, role}
  const [credits, setCredits] = React.useState(null); // {balance, checkin_today, costs, ...}
  const [authOpen, setAuthOpen] = React.useState(false);

  // 拉取积分余额；登录态下调用，未登录清空
  const refreshCredits = React.useCallback(() => {
    if (!getToken()) {
      setCredits(null);
      return;
    }
    getCredits().then(setCredits).catch(() => {});
  }, []);
  // 到期复习提醒（本地通知 + 顶部横幅）
  const reminders = useReminders(user);

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
        })
        .catch(() => setToken(null));
    }
  }, [refreshCredits]);

  function onAuth(res) {
    setToken(res.token);
    setUser({ username: res.username, role: res.role });
    setAuthOpen(false);
    refreshCredits();
  }

  function logout() {
    setToken(null);
    setUser(null);
    setCredits(null);
    if (tab === "admin") setTab("train");
  }

  // 登录态失效（如收到 401）时，清理并弹出登录框
  function requireLogin() {
    setAuthOpen(true);
  }

  return (
    <div className="app">
      <header>
        <h1>象棋道</h1>
        <nav>
          {[
            { key: "train", icon: "🎯", label: "战术训练", short: "训练" },
            { key: "coach", icon: "🧑‍🏫", label: "AI 教练", short: "教练" },
            { key: "challenge", icon: "🏯", label: "闯关", short: "闯关" },
            { key: "stats", icon: "📊", label: "进度统计", short: "统计" },
            { key: "games", icon: "📋", label: "棋局复盘", short: "复盘" },
            { key: "play", icon: "♟️", label: "人机对弈", short: "对弈" },
            ...(user?.role === "admin"
              ? [{ key: "admin", icon: "⚙️", label: "管理后台", short: "后台" }]
              : []),
          ].map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? "active" : ""}
              onClick={() => setTab(t.key)}
            >
              <span className="nav-ico" aria-hidden>{t.icon}</span>
              <span className="nav-label-full">{t.label}</span>
              <span className="nav-label-short">{t.short}</span>
            </button>
          ))}
        </nav>
        <div className="user-box">
          {user ? (
            <>
              <CreditsBadge credits={credits} onCheckin={refreshCredits} />
              <span className="user-name">{user.username}</span>
              <button className="btn-link" onClick={logout}>退出</button>
            </>
          ) : (
            <button className="btn-link" onClick={() => setAuthOpen(true)}>登录 / 注册</button>
          )}
        </div>
      </header>
      {reminders.banner && (
        <div className="reminder-banner">
          <span>{reminders.banner}</span>
          <button className="btn-link" onClick={() => setTab("train")}>去复习 →</button>
          {reminders.canEnable && (
            <button className="btn-link" onClick={reminders.enable}>开启提醒</button>
          )}
          <button className="reminder-x" onClick={reminders.dismiss}>×</button>
        </div>
      )}
      <main>
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
      </main>
      {authOpen && <Auth onClose={() => setAuthOpen(false)} onAuth={onAuth} />}
    </div>
  );
}
