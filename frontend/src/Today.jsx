import React from "react";
import { getToday } from "./api";

const ACTION_ICON = { train: "◎", category: "↺", games: "≡", play: "♟" };

export default function Today({ user, onNavigate, onPractice }) {
  const [plan, setPlan] = React.useState(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    getToday().then((value) => alive && setPlan(value))
      .catch((e) => alive && setError(e.message || "今日计划加载失败"));
    return () => { alive = false; };
  }, [user]);

  function run(action) {
    if (action.type === "category") onPractice?.(action.category);
    else onNavigate?.(action.type);
  }

  if (error) return <div className="panel import-error">{error}</div>;
  if (!plan) return <div className="panel">正在整理今日计划…</div>;
  const primary = plan.actions[0];

  return (
    <div className="today-page">
      <section className="today-hero">
        <div>
          <span className="today-eyebrow">{user ? `${user.username}，继续保持` : "游客进度已保存在本设备"}</span>
          <h2>{plan.due_reviews || plan.pending_blunders ? "今天，先解决最值得练的局面" : "今日任务已准备好"}</h2>
          <p>{plan.due_reviews
            ? `有 ${plan.due_reviews} 道复习到期，完成后再进入新题。`
            : plan.pending_blunders
              ? `有 ${plan.pending_blunders} 道实战错题等待重练。`
              : `可以学习最多 ${plan.new_remaining} 道新题，再下一盘检验成果。`}</p>
        </div>
        {primary && <button className="today-primary" onClick={() => run(primary)}>{primary.label} →</button>}
      </section>

      <section className="today-metrics" aria-label="今日概览">
        <Metric value={plan.due_reviews} label="到期复习" tone="red" />
        <Metric value={plan.pending_blunders} label="实战错题" tone="amber" />
        <Metric value={plan.pending_games} label="待复盘棋局" tone="blue" />
        <Metric value={`${plan.streak_days} 天`} label="连续训练" tone="green" />
      </section>

      <section className="today-grid">
        <div className="panel today-tasks">
          <div className="panel-head"><div><h3>今日行动</h3><p className="muted">按提升价值排序，做完一项再进入下一项。</p></div></div>
          <div className="today-task-list">
            {plan.actions.map((action, index) => (
              <button key={`${action.type}-${index}`} className="today-task" onClick={() => run(action)}>
                <span className="today-task-icon">{ACTION_ICON[action.type] || "·"}</span>
                <span className="today-task-copy">
                  <strong>{action.label}{action.count ? ` · ${action.count}` : ""}</strong>
                  <small>{action.detail}</small>
                </span>
                <span className="today-task-arrow">›</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel today-growth">
          <span className="today-eyebrow">个人成长</span>
          <div className="today-rating">{plan.rating}</div>
          <strong>{plan.title}</strong>
          <div className="today-accuracy"><span>新题首答正确率</span><b>{Math.round(plan.first_try_accuracy * 100)}%</b></div>
          <div className="today-growth-actions">
            <button onClick={() => onNavigate?.("stats")}>查看成长报告</button>
            <button onClick={() => onNavigate?.("coach")}>查看教练建议</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ value, label, tone }) {
  return <div className={`today-metric ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}
