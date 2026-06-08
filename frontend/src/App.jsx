import React from "react";
import Trainer from "./Trainer";
import Stats from "./Stats";
import Games from "./Games";
import Play from "./Play";
import Auth from "./Auth";
import Admin from "./Admin";
import { fetchMe, getToken, setToken } from "./api";

export default function App() {
  const [tab, setTab] = React.useState("train");
  // 训练目标：null | {puzzleId} | {category}，用于从复盘/弱点跳转到指定练习
  const [trainTarget, setTrainTarget] = React.useState(null);
  // 复盘目标：从对弈结束「一键复盘」跳转时携带的棋局 id
  const [reviewGameId, setReviewGameId] = React.useState(null);
  const [user, setUser] = React.useState(null); // {username, role}
  const [authOpen, setAuthOpen] = React.useState(false);

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
          <button className={tab === "train" ? "active" : ""} onClick={() => setTab("train")}>战术训练</button>
          <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>进度统计</button>
          <button className={tab === "games" ? "active" : ""} onClick={() => setTab("games")}>棋局复盘</button>
          <button className={tab === "play" ? "active" : ""} onClick={() => setTab("play")}>人机对弈</button>
          {user?.role === "admin" && (
            <button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>管理后台</button>
          )}
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
      <main>
        {tab === "train" && (
          <Trainer
            target={trainTarget}
            onTargetConsumed={() => setTrainTarget(null)}
          />
        )}
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
