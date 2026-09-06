export const LEVELS = [
  { key: "easy", label: "入门", depth: 6 },
  { key: "medium", label: "进阶", depth: 10 },
  { key: "hard", label: "高手", depth: 14 },
];

export function winnerFor(status, mover) {
  if (status === "checkmate") return mover;
  if (status === "stalemate") return "draw";
  return null;
}

export function describeJieqiEval(data) {
  const { cp, mate } = data || {};
  if (mate != null) {
    return {
      value: `${mate > 0 ? "+" : "-"}M${Math.abs(mate)}`,
      label: `${mate > 0 ? "红方" : "黑方"}${Math.abs(mate)}步可杀`,
      redPct: mate > 0 ? 100 : 0,
    };
  }
  if (cp == null) return { value: "—", label: "暂无评分", redPct: 50 };
  const absolute = Math.abs(cp);
  const advantage = absolute < 60 ? "均势" : absolute < 150 ? "略优" : absolute < 400 ? "占优" : absolute < 900 ? "大优" : "胜势";
  return {
    value: `${cp >= 0 ? "+" : ""}${Math.round(cp)}`,
    label: absolute < 60 ? advantage : `${cp > 0 ? "红方" : "黑方"}${advantage}`,
    redPct: 50 + (Math.max(-1000, Math.min(1000, cp)) / 1000) * 50,
  };
}
