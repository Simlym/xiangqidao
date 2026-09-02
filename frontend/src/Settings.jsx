import React from "react";
import NativeEngineSettings from "./components/NativeEngineSettings";
import { createEngineManager } from "./core/engine/createEngineManager";
import { evalPosition, evalJieqiPosition, getCosmetics, purchaseCosmetic } from "./api";
import { cosmeticPreferences, setCosmeticPreference } from "./cosmetics";
import { playSound, soundMuted, setSoundMuted, soundTheme, setSoundTheme } from "./sounds";
import { analysisPreferences, saveAnalysisPreferences } from "./analysisPreferences";

const xiangqiEngine = createEngineManager({ remoteEvaluate: evalPosition });
const jieqiEngine = createEngineManager({ variant: "jieqi", remoteEvaluate: evalJieqiPosition });
const SECTIONS = [
  { key: "general", label: "通用" },
  { key: "appearance", label: "棋盘与外观" },
  { key: "xiangqi", label: "标准象棋引擎" },
  { key: "jieqi", label: "揭棋引擎" },
];
const TYPE_META = { app: "软件主题色", board: "棋盘", piece: "棋子", sound: "音效" };
const STYLE_PRESETS = [
  {
    key: "clear", name: "清朗大字", audience: "长辈 · 初学者",
    description: "更高对比、更粗线条和清楚的双音提示，远看也不费力。",
    themes: { app: "clear", board: "clear", piece: "bold", sound: "clear" },
  },
  {
    key: "neon", name: "霓虹棋域", audience: "年轻玩家 · 夜间对弈",
    description: "深空界面、发光棋盘与街机音色，操作反馈更有冲劲。",
    themes: { app: "neon", board: "neon", piece: "neon", sound: "arcade" },
  },
  {
    key: "candy", name: "糖果课堂", audience: "儿童 · 亲子学习",
    description: "柔和明亮的积木配色与泡泡音符，让启蒙练习更亲切。",
    themes: { app: "candy", board: "candy", piece: "candy", sound: "bubble" },
  },
  {
    key: "focus", name: "极简专注", audience: "进阶棋手 · 高频训练",
    description: "低饱和灰蓝、平面棋子和轻触音，减少无关视觉刺激。",
    themes: { app: "focus", board: "focus", piece: "focus", sound: "soft" },
  },
  {
    key: "scholar", name: "丹青文房", audience: "传统文化 · 书法爱好者",
    description: "宣纸、淡墨和篆印棋子，保留最有文人气的落木声。",
    themes: { app: "ink", board: "paper", piece: "seal", sound: "wood" },
  },
  {
    key: "palace", name: "宫廷朱漆", audience: "古典华丽 · 收藏玩家",
    description: "宫墙朱红、经典木枰与漆金棋子，仪式感更强。",
    themes: { app: "palace", board: "classic", piece: "lacquer", sound: "crisp" },
  },
  {
    key: "coast", name: "海岛假日", audience: "休闲对弈 · 轻松氛围",
    description: "海盐蓝、细沙棋盘和贝壳棋子，搭配圆润泡泡音。",
    themes: { app: "coast", board: "coast", piece: "shell", sound: "bubble" },
  },
  {
    key: "forest", name: "松林棋社", audience: "自然爱好者 · 长时对弈",
    description: "苔庭棋盘与溪石棋子，低刺激色彩适合慢慢下。",
    themes: { app: "forest", board: "forest", piece: "stone", sound: "wood" },
  },
  {
    key: "mono", name: "黑白研究室", audience: "局面分析 · 录屏直播",
    description: "纯灰阶、高辨识棋子与轻触音，画面干净便于讲解。",
    themes: { app: "mono", board: "mono", piece: "mono", sound: "soft" },
  },
  {
    key: "pixel", name: "像素残局", audience: "复古玩家 · 掌机爱好者",
    description: "液晶绿网格、像素棋子与街机脉冲，回到掌机年代。",
    themes: { app: "pixel", board: "pixel", piece: "pixel", sound: "arcade" },
  },
];

export default function Settings({ user, credits, onCreditsChanged, onRequireLogin }) {
  const [section, setSection] = React.useState("general");
  const [muted, setMuted] = React.useState(soundMuted);
  const [theme, setTheme] = React.useState(soundTheme);
  const [appearance, setAppearance] = React.useState(cosmeticPreferences);
  const [catalog, setCatalog] = React.useState([]);
  const [storeBusy, setStoreBusy] = React.useState("");
  const [storeNotice, setStoreNotice] = React.useState(null);
  const [jieqiAnalysis, setJieqiAnalysis] = React.useState(() => analysisPreferences("jieqi"));

  const loadCatalog = React.useCallback(() => getCosmetics().then((result) => {
    setCatalog(result.items || []);
    return result;
  }), []);
  React.useEffect(() => {
    loadCatalog().catch(() => setStoreNotice({ type: "error", text: "外观目录暂时无法读取" }));
  }, [loadCatalog, user]);

  function changeMuted(next) {
    setMuted(next);
    setSoundMuted(next);
    if (!next) playSound("move");
  }

  function changeTheme(next) {
    setTheme(next);
    setSoundTheme(next);
    if (muted) {
      setMuted(false);
      setSoundMuted(false);
    }
    window.setTimeout(() => playSound("move"), 0);
  }

  function useItem(item) {
    if (!item.owned) return;
    if (item.type === "sound") changeTheme(item.theme);
    else {
      setCosmeticPreference(item.type, item.theme);
      setAppearance({ ...cosmeticPreferences(), [item.type]: item.theme });
    }
    setStoreNotice({ type: "success", text: `已使用「${item.name}」` });
  }

  function usePreset(preset) {
    // 当前推荐套装全部由内置免费外观组成，不应依赖服务端目录的加载时序。
    // 未来若加入付费套装，显式标记 requiresOwnership 后再逐项校验权益。
    if (preset.requiresOwnership) {
      const lockedItems = Object.entries(preset.themes).filter(([type, themeKey]) => {
        const item = catalog.find((candidate) => candidate.type === type && candidate.theme === themeKey);
        return !item?.owned;
      });
      if (lockedItems.length > 0) {
        setStoreNotice({ type: "error", text: `套装中还有 ${lockedItems.length} 项未解锁，请先单独解锁。` });
        return;
      }
    }
    for (const type of ["app", "board", "piece"]) {
      setCosmeticPreference(type, preset.themes[type]);
    }
    setAppearance({
      app: preset.themes.app,
      board: preset.themes.board,
      piece: preset.themes.piece,
    });
    changeTheme(preset.themes.sound);
    setStoreNotice({ type: "success", text: `已应用「${preset.name}」整套搭配` });
  }

  function changeJieqiAnalysis(patch) {
    setJieqiAnalysis((current) => saveAnalysisPreferences({ ...current, ...patch }, "jieqi"));
  }

  async function buyItem(item) {
    if (!user) {
      onRequireLogin?.();
      return;
    }
    setStoreBusy(item.key);
    setStoreNotice(null);
    try {
      await purchaseCosmetic(item.key);
      await loadCatalog();
      onCreditsChanged?.();
      setStoreNotice({ type: "success", text: `已永久解锁「${item.name}」` });
    } catch (error) {
      setStoreNotice({
        type: "error",
        itemKey: item.key,
        text: error.message || "解锁失败，请稍后重试",
      });
    } finally {
      setStoreBusy("");
    }
  }

  const selectedTheme = (type) => type === "sound" ? theme : appearance[type];
  return (
    <div className="settings-page">
      <aside className="settings-sections" aria-label="设置分类">
        {SECTIONS.map((item) => (
          <button key={item.key} className={section === item.key ? "active" : ""} onClick={() => setSection(item.key)}>{item.label}</button>
        ))}
      </aside>

      <section className="settings-content">
        {section === "general" && (
          <div className="settings-group">
            <div className="settings-heading"><h2>通用设置</h2><p>这些偏好会保存在当前设备上。</p></div>
            <div className="settings-row">
              <div><strong>对弈音效</strong><p>走子、吃子和对局结果提示音。</p></div>
              <label className="settings-switch">
                <input type="checkbox" checked={!muted} onChange={(event) => changeMuted(!event.target.checked)} />
                <span>{muted ? "关闭" : "开启"}</span>
              </label>
            </div>
          </div>
        )}

        {section === "appearance" && (
          <div className="settings-group cosmetic-store">
            <div className="settings-heading"><h2>个性化外观</h2><p>免费款可直接使用；付费款用积分买断，登录账号后永久有效。</p></div>
            <div className="cosmetic-balance">
              <span>{user ? `当前余额：💎 ${credits?.balance ?? "…"}` : "游客可使用所有免费款"}</span>
              {storeNotice?.type === "success" && (
                <span className="cosmetic-message" role="status">{storeNotice.text}</span>
              )}
              {storeNotice?.type === "error" && !storeNotice.itemKey && (
                <span className="cosmetic-message error" role="alert">{storeNotice.text}</span>
              )}
            </div>
            <section className="cosmetic-presets" aria-labelledby="cosmetic-presets-title">
              <div className="cosmetic-presets-heading">
                <div><h3 id="cosmetic-presets-title">推荐套装</h3><p>一键应用整套，也可以继续在下方自由混搭。</p></div>
              </div>
              <div className="cosmetic-preset-grid">
                {STYLE_PRESETS.map((preset) => {
                  const selected = Object.entries(preset.themes).every(([type, value]) => selectedTheme(type) === value);
                  return (
                    <article className={`cosmetic-preset preset-${preset.key} ${selected ? "selected" : ""}`} key={preset.key}>
                      <div className="preset-visual" aria-hidden="true">
                        <span className="preset-board-mark">楚河</span><span className="preset-piece-mark">帥</span>
                      </div>
                      <div className="preset-copy">
                        <span className="preset-audience">{preset.audience}</span>
                        <strong>{preset.name}</strong>
                        <p>{preset.description}</p>
                      </div>
                      <button disabled={selected} onClick={() => usePreset(preset)}>{selected ? "整套使用中" : "一键应用"}</button>
                    </article>
                  );
                })}
              </div>
            </section>
            {Object.entries(TYPE_META).map(([type, title]) => (
              <section className="cosmetic-category" key={type}>
                <h3>{title}</h3>
                <div className="cosmetic-grid">
                  {catalog.filter((item) => item.type === type).map((item) => {
                    const selected = selectedTheme(type) === item.theme;
                    return (
                      <article className={`cosmetic-card ${selected ? "selected" : ""}`} key={item.key}>
                        <div className={`cosmetic-preview preview-${item.type}-${item.theme}`} aria-hidden>
                          {item.type === "piece" ? "帥" : item.type === "sound" ? "♫" : item.type === "app" ? "道" : ""}
                        </div>
                        <div className="cosmetic-card-body">
                          <strong>{item.name}</strong><p>{item.description}</p>
                          <span className={item.price === 0 ? "cosmetic-free" : "cosmetic-price"}>
                            {item.price === 0 ? "免费" : item.owned ? "已购买" : `💎 ${item.price}`}
                          </span>
                        </div>
                        {item.owned ? (
                          <button disabled={selected} onClick={() => useItem(item)}>{selected ? "使用中" : type === "sound" ? "试听并使用" : "使用"}</button>
                        ) : (
                          <button disabled={storeBusy === item.key} onClick={() => buyItem(item)}>{storeBusy === item.key ? "解锁中…" : `解锁 💎 ${item.price}`}</button>
                        )}
                        {storeNotice?.type === "error" && storeNotice.itemKey === item.key && (
                          <p className="cosmetic-purchase-error" role="alert">{storeNotice.text}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {section === "xiangqi" && (
          <div className="settings-group">
            <div className="settings-heading"><h2>标准象棋引擎</h2><p>用于人机对弈、局面评分和着法提示。</p></div>
            <NativeEngineSettings manager={xiangqiEngine} />
          </div>
        )}
        {section === "jieqi" && (
          <div className="settings-group">
            <div className="settings-heading"><h2>揭棋引擎</h2><p>揭棋需要支持暗子局面的专用引擎，配置与标准象棋相互独立。</p></div>
            <section className="analysis-default-settings">
              <div>
                <strong>默认分析设置</strong>
                <p>新进入揭棋对局时采用这些参数；对局中仍可临时修改。无限分析需要本地引擎。</p>
              </div>
              <div className="engine-analysis-controls">
                <label>模式
                  <select value={jieqiAnalysis.mode} onChange={(event) => changeJieqiAnalysis({ mode: event.target.value })} aria-label="默认分析模式">
                    <option value="movetime">限时分析</option>
                    <option value="depth">深度分析</option>
                    <option value="infinite">无限分析</option>
                  </select>
                </label>
                {jieqiAnalysis.mode === "movetime" && <label>时长
                  <select value={jieqiAnalysis.time} onChange={(event) => changeJieqiAnalysis({ time: Number(event.target.value) })} aria-label="默认分析时间">
                    <option value={500}>0.5 秒</option><option value={1000}>1 秒</option><option value={3000}>3 秒</option><option value={5000}>5 秒</option>
                  </select>
                </label>}
                {jieqiAnalysis.mode === "depth" && <label>深度
                  <input type="number" min="1" max="30" value={jieqiAnalysis.depth} onChange={(event) => changeJieqiAnalysis({ depth: Number(event.target.value) || 1 })} aria-label="默认分析深度" />
                </label>}
                <label>线路
                  <select value={jieqiAnalysis.multiPv} onChange={(event) => changeJieqiAnalysis({ multiPv: Number(event.target.value) })} aria-label="默认候选线路数">
                    <option value={1}>最佳 1 线</option><option value={3}>候选 3 线</option><option value={5}>候选 5 线</option>
                  </select>
                </label>
              </div>
            </section>
            <NativeEngineSettings manager={jieqiEngine} variant="jieqi" label="揭棋 Pikafish" />
          </div>
        )}
      </section>
    </div>
  );
}
