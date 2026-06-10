import React from "react";
import Trainer from "./Trainer";
import Stats from "./Stats";
import Games from "./Games";
import Play from "./Play";
import Challenge from "./Challenge";
import Auth from "./Auth";
import Admin from "./Admin";
import { fetchMe, getToken, setToken } from "./api";
import { useReminders } from "./reminders";

export default function App() {
  const [tab, setTab] = React.useState("train");
  // 训练目标：null | {puzzleId} | {category}，用于从复盘/弱点跳转到指定练习
  const [trainTarget, setTrainTarget] = React.useState(null);
  // 复盘目标：从对弈结束「一键复盘」跳转时携带的棋局 id
  const [reviewGameId, setReviewGameId] = React.useState(null);
  const [user, setUser] = React.useState(null); // {username, role}
  const [authOpen, setAuthOpen] = React.useState(false);
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

  // 启动时若有 token，拉取当前用户
  React.useEffect(() => {
    if (getToken()) {
      fetchMe()
        .then((u) => setUser(u))
        .catch(() => setToken(null));
    }
  }, []);

  function onAuth(res) {
    setToken(res.token);
    setUser({ username: res.username, role: res.role });
    setAuthOpen(false);
  }

  function logout() {
    setToken(null);
    setUser(null);
    if (tab === "admin") setTab("train");
  }

  return (
    <div className="app">
      <header>
        <h1>象棋道</h1>
        <nav>
          {[
            { key: "train", icon: "🎯", label: "战术训练", short: "训练" },
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
          />
        )}
        {tab === "challenge" && <Challenge />}
        {tab === "stats" && <Stats onPractice={practiceCategory} />}
        {tab === "play" && <Play onGoReview={reviewGame} />}
        {tab === "admin" && user?.role === "admin" && <Admin />}
        {tab === "games" && (
          <Games
            initialGameId={reviewGameId}
            onInitialGameConsumed={() => setReviewGameId(null)}
            onNavigateToTrain={practicePuzzle}
          />
        )}
      </main>
      {authOpen && <Auth onClose={() => setAuthOpen(false)} onAuth={onAuth} />}
    </div>
  );
}
