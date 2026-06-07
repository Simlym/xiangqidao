import React from "react";
import Trainer from "./Trainer";
import Stats from "./Stats";
import Games from "./Games";

export default function App() {
  const [tab, setTab] = React.useState("train");
  return (
    <div className="app">
      <header>
        <h1>象棋道</h1>
        <nav>
          <button
            className={tab === "train" ? "active" : ""}
            onClick={() => setTab("train")}
          >
            战术训练
          </button>
          <button
            className={tab === "stats" ? "active" : ""}
            onClick={() => setTab("stats")}
          >
            进度统计
          </button>
          <button
            className={tab === "games" ? "active" : ""}
            onClick={() => setTab("games")}
          >
            棋局复盘
          </button>
        </nav>
      </header>
      <main>
        {tab === "train" && <Trainer />}
        {tab === "stats" && <Stats />}
        {tab === "games" && <Games />}
      </main>
    </div>
  );
}
