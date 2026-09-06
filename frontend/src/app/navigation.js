export const TAB_DESCRIPTIONS = {
  today: "今日任务与下一步行动",
  train: "今日计划与专项训练",
  coach: "个性化棋力建议",
  challenge: "循序渐进提升棋力",
  stats: "训练记录与能力变化",
  games: "查看棋谱并分析得失",
  play: "与本地或云端引擎对弈",
  jieqi: "揭棋对弈",
  admin: "当前 Web 服务的用户、内容与云端配置",
  settings: "应用偏好与本地引擎配置",
};

export const PRIMARY_GROUPS = [
  { key: "today", icon: "◷", label: "今日", short: "今日", defaultTab: "today", tabs: ["today", "stats", "coach"] },
  { key: "training", icon: "◎", label: "训练", short: "训练", defaultTab: "train", tabs: ["train", "learning", "challenge"] },
  { key: "playing", icon: "♟", label: "对弈", short: "对弈", defaultTab: "play", tabs: ["play", "jieqi"] },
  { key: "records", icon: "≡", label: "棋谱", short: "棋谱", defaultTab: "games", tabs: ["games"] },
];

export const PAGE_TABS = [
  { key: "today", label: "今日计划" },
  { key: "stats", label: "成长报告" },
  { key: "coach", label: "教练建议" },
  { key: "train", label: "每日训练" },
  { key: "learning", label: "学习地图与测评" },
  { key: "challenge", label: "闯关" },
  { key: "play", label: "标准象棋" },
  { key: "jieqi", label: "揭棋" },
  { key: "games", label: "我的棋局" },
];

export function resolveNavigation(tab, { isDesktop, isAdmin }) {
  const utilityTabs = [
    { key: "settings", icon: "⚙️", desktopIcon: "⚙", label: isDesktop ? "本机设置" : "设置", short: "设置" },
    ...(isAdmin ? [{ key: "admin", icon: "◎", desktopIcon: "◎", label: isDesktop ? "Web 管理后台" : "管理后台", short: "后台" }] : []),
  ];
  return {
    utilityTabs,
    activeGroup: PRIMARY_GROUPS.find((group) => group.tabs.includes(tab)),
    activeTab: [...PAGE_TABS, ...utilityTabs].find((item) => item.key === tab) || PAGE_TABS[0],
  };
}
