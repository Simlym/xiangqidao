// 棋局时间戳工具：对局保存为本地时间「YYYY-MM-DD HH:MM:SS」字符串（played_on），
// 复盘列表据此精确到秒区分对局。旧对局可能只有「YYYY-MM-DD」，需兼容。

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Date → 本地时间戳字符串「YYYY-MM-DD HH:MM:SS」（不带时区，保存到 played_on）
export function formatLocalTimestamp(d) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    ` ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

// 把 played_on 拆成 { date, time } 两段用于展示。
// 兼容三种历史格式：「YYYY-MM-DD HH:MM:SS」「YYYY-MM-DDTHH:MM…」(ISO) 与仅「YYYY-MM-DD」。
// 找不到时间段时 time 为 ""。
export function splitPlayedOn(playedOn) {
  if (!playedOn) return { date: "", time: "" };
  const s = String(playedOn).trim();
  // 日期 + 时间（空格或 T 分隔）
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/);
  if (m) {
    return { date: m[1], time: m[2] + (m[3] || "") };
  }
  const dOnly = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dOnly) return { date: dOnly[1], time: "" };
  // 无法识别：原样作为日期返回
  return { date: s, time: "" };
}
