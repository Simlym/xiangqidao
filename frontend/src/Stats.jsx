import React from "react";
import { getOverview, getByCategory, getWeekly, getForecast } from "./api";

export default function Stats() {
  const [ov, setOv] = React.useState(null);
  const [cats, setCats] = React.useState([]);
  const [weekly, setWeekly] = React.useState([]);
  const [forecast, setForecast] = React.useState([]);

  React.useEffect(() => {
    getOverview().then(setOv);
    getByCategory().then(setCats);
    getWeekly().then(setWeekly);
    getForecast(14).then(setForecast);
  }, []);

  if (!ov) return <div className="panel">加载中…</div>;

  return (
    <div className="stats">
      <div className="cards">
        <Card label="连续打卡" value={`${ov.streak_days} 天`} />
        <Card label="今日到期" value={`${ov.due_today} 题`} />
        <Card label="已学题数" value={`${ov.learned}/${ov.total_puzzles}`} />
        <Card label="首答正确率" value={`${Math.round((ov.first_try_accuracy ?? 0) * 100)}%`} />
        <Card label="总正确率" value={`${Math.round(ov.overall_accuracy * 100)}%`} />
      </div>

      <div className="panel">
        <h3>各杀法正确率（最弱在前）</h3>
        {cats.length === 0 ? (
          <p className="muted">还没有数据，先去练几题。</p>
        ) : (
          cats.map((c) => (
            <div className="bar-row" key={c.category}>
              <span className="bar-label">{c.category}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${Math.round(c.accuracy * 100)}%` }}
                />
              </div>
              <span className="bar-val">
                {Math.round(c.accuracy * 100)}% ({c.attempts})
              </span>
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <h3>复习日程（遗忘曲线）</h3>
        {forecast.every((f) => f.count === 0) ? (
          <p className="muted">暂无待复习题目，练几道新题后这里会显示未来的复习安排。</p>
        ) : (
          <div className="forecast">
            {(() => {
              const max = Math.max(1, ...forecast.map((f) => f.count));
              return forecast.map((f) => (
                <div className="forecast-col" key={f.day} title={`${f.day}: ${f.count} 题`}>
                  <span className="forecast-num">{f.count || ""}</span>
                  <div
                    className={"forecast-bar" + (f.overdue ? " overdue" : "")}
                    style={{ height: `${f.count ? Math.max(6, Math.round((f.count / max) * 100)) : 0}%` }}
                  />
                  <span className="forecast-x">{f.label}</span>
                </div>
              ));
            })()}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>每周正确率趋势</h3>
        {weekly.length === 0 ? (
          <p className="muted">累计满一周后显示趋势。</p>
        ) : (
          <div className="spark">
            {weekly.map((w) => (
              <div className="spark-col" key={w.week_start} title={`${w.week_start}: ${Math.round(w.accuracy * 100)}% / ${w.attempts}题`}>
                <div
                  className="spark-bar"
                  style={{ height: `${Math.max(4, Math.round(w.accuracy * 100))}%` }}
                />
                <span className="spark-x">{w.week_start.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ label, value }) {
  return (
    <div className="card">
      <div className="card-value">{value}</div>
      <div className="card-label">{label}</div>
    </div>
  );
}
