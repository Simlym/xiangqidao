import React from "react";
import { getCurriculum, getMastery, getLearningProgress, startAssessment } from "./api";

export default function Learning({ onPractice, onStartPack }) {
  const [curriculum, setCurriculum] = React.useState([]);
  const [mastery, setMastery] = React.useState([]);
  const [progress, setProgress] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    Promise.all([getCurriculum(), getMastery(), getLearningProgress(28)])
      .then(([c, m, p]) => { setCurriculum(c); setMastery(m); setProgress(p); })
      .catch((e) => setError(e.message));
  }, []);

  async function beginAssessment() {
    setBusy(true); setError("");
    try {
      const pack = await startAssessment();
      onStartPack?.(pack);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const concepts = mastery.filter((m) => m.type !== "kind").slice(0, 10);
  return (
    <div className="learning-page">
      <section className="panel assessment-hero">
        <div>
          <span className="eyebrow">阶段测评</span>
          <h2>用 8 道混合题检验真实提升</h2>
          <p className="muted">覆盖现有内容域，首答率会与最近 20 次训练基线直接比较。</p>
        </div>
        <button onClick={beginAssessment} disabled={busy}>{busy ? "正在组卷…" : "开始阶段测评"}</button>
      </section>
      {error && <div className="panel result bad">{error}</div>}

      {progress && <section className="panel">
        <h3>训练前后对比 · 最近 {progress.period_days} 天</h3>
        {progress.enough_data ? <div className="comparison-grid">
          <Compare label="首答正确率" before={pct(progress.before.first_try_accuracy)} after={pct(progress.after.first_try_accuracy)} delta={`${progress.accuracy_delta >= 0 ? "+" : ""}${Math.round(progress.accuracy_delta * 100)}%`} />
          <Compare label="平均用时" before={`${progress.before.avg_seconds}s`} after={`${progress.after.avg_seconds}s`} delta={`${progress.speed_delta_seconds >= 0 ? "快 " : "慢 "}${Math.abs(progress.speed_delta_seconds)}s`} />
        </div> : <p className="muted">前后两个周期各完成至少 3 次训练后生成可靠对比。</p>}
      </section>}

      <section className="panel">
        <h3>内容地图</h3>
        <div className="curriculum-grid">
          {curriculum.map((area) => <article className={`curriculum-card ${area.available ? "" : "empty"}`} key={area.kind}>
            <div className="curriculum-head"><strong>{area.kind}</strong><span>{area.total} 题</span></div>
            <p>{area.goal}</p>
            <div className="skill-chips">{area.skills.map((s) => <span key={s}>{s}</span>)}</div>
            {area.available ? <button className="btn-link" onClick={() => onPractice?.({ kind: area.kind })}>进入专项 →</button> : <small>内容待补充</small>}
          </article>)}
        </div>
      </section>

      <section className="panel">
        <h3>标签掌握度与错误复发</h3>
        {concepts.length ? concepts.map((item) => <div className="mastery-row" key={`${item.type}:${item.name}`}>
          <button className="btn-link mastery-name" onClick={() => item.type === "category" && onPractice?.({ category: item.name })}>{item.name}</button>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${item.mastery}%` }} /></div>
          <span>{item.mastery}%</span><small>复发 {pct(item.recurrence_rate)}</small>
        </div>) : <p className="muted">完成几次训练后，这里会显示具体棋理标签的掌握度。</p>}
      </section>
    </div>
  );
}

const pct = (v) => `${Math.round((v || 0) * 100)}%`;
function Compare({ label, before, after, delta }) {
  return <div className="comparison-card"><strong>{label}</strong><div><span>{before}</span><b>→</b><span>{after}</span></div><small>{delta}</small></div>;
}
