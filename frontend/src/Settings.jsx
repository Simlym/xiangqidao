import React from "react";
import NativeEngineSettings from "./components/NativeEngineSettings";
import { createEngineManager } from "./core/engine/createEngineManager";
import { evalPosition, evalJieqiPosition } from "./api";
import {
  playSound,
  soundMuted,
  setSoundMuted,
  soundTheme,
  setSoundTheme,
  SOUND_THEMES,
} from "./sounds";

const xiangqiEngine = createEngineManager({ remoteEvaluate: evalPosition });
const jieqiEngine = createEngineManager({ variant: "jieqi", remoteEvaluate: evalJieqiPosition });

const SECTIONS = [
  { key: "general", label: "通用" },
  { key: "xiangqi", label: "标准象棋引擎" },
  { key: "jieqi", label: "揭棋引擎" },
];

export default function Settings() {
  const [section, setSection] = React.useState("general");
  const [muted, setMuted] = React.useState(soundMuted);
  const [theme, setTheme] = React.useState(soundTheme);

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

  return (
    <div className="settings-page">
      <aside className="settings-sections" aria-label="设置分类">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            className={section === item.key ? "active" : ""}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </aside>

      <section className="settings-content">
        {section === "general" && (
          <div className="settings-group">
            <div className="settings-heading">
              <h2>通用设置</h2>
              <p>这些偏好会保存在当前设备上。</p>
            </div>
            <div className="settings-row">
              <div>
                <strong>对弈音效</strong>
                <p>走子、吃子和对局结果提示音。</p>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={!muted}
                  onChange={(event) => changeMuted(!event.target.checked)}
                />
                <span>{muted ? "关闭" : "开启"}</span>
              </label>
            </div>
            <div className="settings-row">
              <div>
                <strong>音效主题</strong>
                <p>选择后会立即播放一次试听。</p>
              </div>
              <select value={theme} onChange={(event) => changeTheme(event.target.value)}>
                {SOUND_THEMES.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {section === "xiangqi" && (
          <div className="settings-group">
            <div className="settings-heading">
              <h2>标准象棋引擎</h2>
              <p>用于人机对弈、局面评分和着法提示。</p>
            </div>
            <NativeEngineSettings manager={xiangqiEngine} />
          </div>
        )}

        {section === "jieqi" && (
          <div className="settings-group">
            <div className="settings-heading">
              <h2>揭棋引擎</h2>
              <p>揭棋需要支持暗子局面的专用引擎，配置与标准象棋相互独立。</p>
            </div>
            <NativeEngineSettings
              manager={jieqiEngine}
              variant="jieqi"
              label="揭棋 Pikafish"
            />
          </div>
        )}
      </section>
    </div>
  );
}
