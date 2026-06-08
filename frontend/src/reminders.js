import React from "react";
import { getOverview } from "./api";

// 到期复习提醒（MVP：本地通知 + 顶部横幅）。
// 真正的服务端推送（Web Push / 微信模板消息）属于后续步骤，这里先用浏览器
// 本地 Notification 把「今天有题到期、别断打卡」这件事推到用户眼前。

const DISMISS_KEY = "xq_reminder_dismissed"; // 值为 ISO 日期，当天内不再打扰
const NOTIFIED_KEY = "xq_reminder_notified"; // 值为 ISO 日期，当天只弹一次系统通知

function today() {
  return new Date().toISOString().slice(0, 10);
}

// 注册 service worker，使站点可「安装到桌面/主屏」（PWA），失败静默。
export function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function notify(due, streak) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (localStorage.getItem(NOTIFIED_KEY) === today()) return;
  localStorage.setItem(NOTIFIED_KEY, today());
  const body = streak > 0
    ? `今天有 ${due} 道题到期，连续打卡 ${streak} 天，别断哦！`
    : `今天有 ${due} 道题到期复习，来练几道吧。`;
  try {
    new Notification("象棋道 · 复习提醒", { body, tag: "xq-due" });
  } catch {
    /* 某些浏览器要求由 SW 触发，忽略 */
  }
}

export function useReminders(user) {
  const [due, setDue] = React.useState(0);
  const [streak, setStreak] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(
    localStorage.getItem(DISMISS_KEY) === today()
  );
  const [perm, setPerm] = React.useState(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  React.useEffect(() => { registerSW(); }, []);

  // 登录态变化时拉取到期数（匿名也可，按访客数据）
  React.useEffect(() => {
    let live = true;
    getOverview()
      .then((ov) => {
        if (!live) return;
        setDue(ov.due_today || 0);
        setStreak(ov.streak_days || 0);
        if ((ov.due_today || 0) > 0) notify(ov.due_today, ov.streak_days);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [user]);

  const enable = React.useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted" && due > 0) notify(due, streak);
  }, [due, streak]);

  const dismiss = React.useCallback(() => {
    localStorage.setItem(DISMISS_KEY, today());
    setDismissed(true);
  }, []);

  const banner =
    !dismissed && due > 0
      ? `📚 今天有 ${due} 道题到期复习${streak > 0 ? `，连续打卡 ${streak} 天` : ""}`
      : null;

  return { banner, canEnable: perm === "default", enable, dismiss };
}
