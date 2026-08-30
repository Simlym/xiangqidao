import React from "react";
import NativeEngineSettings from "./components/NativeEngineSettings";
import { createEngineManager } from "./core/engine/createEngineManager";
import { evalPosition, evalJieqiPosition, getCosmetics, purchaseCosmetic } from "./api";
import { cosmeticPreferences, setCosmeticPreference } from "./cosmetics";
import { playSound, soundMuted, setSoundMuted, soundTheme, setSoundTheme } from "./sounds";

const xiangqiEngine = createEngineManager({ remoteEvaluate: evalPosition });
const jieqiEngine = createEngineManager({ variant: "jieqi", remoteEvaluate: evalJieqiPosition });
const SECTIONS = [
  { key: "general", label: "通用" },
  { key: "appearance", label: "棋盘与外观" },
  { key: "xiangqi", label: "标准象棋引擎" },
  { key: "jieqi", label: "揭棋引擎" },
];
const TYPE_META = { app: "软件主题色", board: "棋盘", piece: "棋子", sound: "音效" };

export default function Settings({ user, credits, onCreditsChanged, onRequireLogin }) {
  const [section, setSection] = React.useState("general");
  const [muted, setMuted] = React.useState(soundMuted);
  const [theme, setTheme] = React.useState(soundTheme);
  const [appearance, setAppearance] = React.useState(cosmeticPreferences);
  const [catalog, setCatalog] = React.useState([]);
  const [storeBusy, setStoreBusy] = React.useState("");
  const [storeNotice, setStoreNotice] = React.useState(null);

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
            <NativeEngineSettings manager={jieqiEngine} variant="jieqi" label="揭棋 Pikafish" />
          </div>
        )}
      </section>
    </div>
  );
}
