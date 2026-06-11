import React from "react";
import { getCoachPlan, refreshCoachPlan, getRating, getOverview } from "./api";

// 建议类型 → 行动按钮文案与跳转
function recAction(rec, { onPractice, onNavigate }) {
  switch (rec.type) {
    case "review":
      return { label: `去复习${rec.count ? `（${rec.count} 题到期）` : ""}`, go: () => onNavigate("train") };
    case "category":
      return {
        label: `专项练习：${rec.category}${rec.count ? `（${rec.count} 题）` : ""}`,
        go: () => onPractice(rec.category),
      };
    case "play":
      return { label: "去下一盘", go: () => onNavigate("play") };
    default:
      return { label: "去训练", go: () => onNavigate("train") };
  }
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    // 后端是无时区的 UTC 时间，补 Z 后按本地时区展示
    return new Date(iso.endsWith("Z") ? iso : iso + "Z").toLocaleString("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export default function Coach({ onPractice, onNavigate }) {
  const [data, setData] = React.useState(null);       // {plan, llm_enabled}
  const [rating, setRating] = React.useState(null);   // {rating, title, peak, solved}
  const [overview, setOverview] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    Promise.all([
      getCoachPlan().catch(() => null),
      getRating().catch(() => null),
      getOverview().catch(() => null),
    ])
      .then(([d, r, o]) => {
        setData(d);
        setRating(r);
        setOverview(o);
      })
      .finally(() => setLoading(false));
  }, []);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const d = await refreshCoachPlan();
      setData(d);
    } catch (e) {
      setError(e.message || "生成失败，请稍后再试");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <div className="panel">加载中…</div>;

  const plan = data?.plan || null;
  const llmEnabled = data?.llm_enabled;
  const triggerText = plan
    ? plan.trigger?.startsWith("game:")
      ? "依据最近一局对弈分析自动生成"
      : "手动生成"
    : "";

  return (
    <div className="coach">
      {/* 水平卡片：让用户先知道「我现在什么水平」 */}
      <div className="panel rating-panel">
        <div className="rating-main">
          <span className="rating-num">{rating?.rating ?? 1200}</span>
          <div className="rating-meta">
            <span className="rating-title">{rating?.title || "未定级"}</span>
            <span className="muted">
              历史最高 {rating?.peak ?? "—"} · 已结算 {rating?.solved ?? 0} 题
            </span>
            {overview && (
              <span className="muted">
                首答正确率 {Math.round((overview.first_try_accuracy || 0) * 100)}% ·
                连续打卡 {overview.streak_days} 天 · 今日到期 {overview.due_today} 题
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 训练计划 */}
      <div className="panel">
        <div className="coach-plan-head">
          <h3 style={{ margin: 0, color: "#8a5a2b" }}>🧑‍🏫 我的训练计划</h3>
          <button className="btn-newgame" onClick={refresh} disabled={refreshing}>
            {refreshing ? "教练备课中…" : plan ? "更新计划" : "生成计划"}
          </button>
        </div>
        {plan && (
          <div className="muted" style={{ margin: "6px 0 10px" }}>
            {fmtTime(plan.created_at)} · {triggerText}
          </div>
        )}
        {error && <div className="import-error">{error}</div>}

        {!plan ? (
          <p className="muted">
            还没有训练计划。点「生成计划」，教练会根据你的评分、弱点雷达和近期对局失误，
            制定一份针对性的训练安排；之后每局对弈复盘完成时会自动更新。
          </p>
        ) : (
          <>
            {/* LLM 教练叙述：未启用时退化为纯数据计划 */}
            {plan.plan_text ? (
              <div className="analysis-explanation ai-explain coach-plan-text">
                {plan.plan_text}
              </div>
            ) : (
              <p className="muted">
                {llmEnabled
                  ? "本次未生成教练点评，下方为数据驱动的训练安排。"
                  : "未启用 AI 大模型（管理员可在后台配置），以下为数据驱动的训练安排；开启后教练会附上水平评估与指导。"}
              </p>
            )}

            {/* 行动建议（按优先级） */}
            <div className="coach-rec-list">
              {plan.recommendations.map((rec, i) => {
                const act = recAction(rec, { onPractice, onNavigate });
                return (
                  <div key={i} className="coach-rec">
                    <span className="coach-rec-no">{i + 1}</span>
                    <span className="coach-rec-reason">{rec.reason}</span>
                    <button className="btn-newgame coach-rec-btn" onClick={act.go}>
                      {act.label} →
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 计划生成时点出的弱点（来自画像快照） */}
            {plan.profile?.weak_categories?.length > 0 && (
              <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                当前弱点：
                {plan.profile.weak_categories
                  .map((w) => `${w.category}（${Math.round(w.accuracy * 100)}%）`)
                  .join("、")}
              </div>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          💡 工作方式：每局人机对弈结束并完成复盘分析后，教练会结合本局失误自动更新计划；
          实战漏着会自动生成你的专属练习题（「实战漏算」类目）。坚持「对局 → 复盘 →
          按计划专项训练」的循环，评分与弱点雷达会客观反映你的进步。
        </div>
      </div>
    </div>
  );
}
