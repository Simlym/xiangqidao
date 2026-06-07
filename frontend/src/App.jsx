import React from "react";
import Trainer from "./Trainer";
import Stats from "./Stats";

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
        </nav>
      </header>
      <main>{tab === "train" ? <Trainer /> : <Stats />}</main>
    </div>
  );
}
