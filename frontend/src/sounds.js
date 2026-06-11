// 对弈音效：用 Web Audio 现场合成（无需音频资源文件，离线也可用）。
// 提供多套可切换音色：木质（默认，滤波噪声模拟实木棋子落枰）、清脆、电子。
// 浏览器要求首次播放前有用户手势；棋类场景里走子本身就是点击，天然满足。

let ctx = null;
let noiseBuf = null;

function audioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

const MUTE_KEY = "xq_sound_muted";
const THEME_KEY = "xq_sound_theme";

export const SOUND_THEMES = [
  { key: "wood", label: "木质" },
  { key: "crisp", label: "清脆" },
  { key: "beep", label: "电子" },
];

export function soundMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch { /* 隐私模式等存不了就算了 */ }
}

export function soundTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return SOUND_THEMES.some((x) => x.key === t) ? t : "wood";
  } catch {
    return "wood";
  }
}

export function setSoundTheme(key) {
  try {
    localStorage.setItem(THEME_KEY, key);
  } catch { /* ignore */ }
}

// 播放一个包络衰减的单音。time 为相对当前的起始秒数，to 给出则做频率滑音。
function tone(c, { freq, to = freq, time = 0, dur = 0.1, type = "sine", gain = 0.2 }) {
  const o = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + time;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// 短促噪声敲击：带通滤波白噪声 + 指数衰减，是木质敲击声的主体。
// q 越大越接近梆子那种有音高的「笃」，q 小则是松散的「嗒」。
function knock(c, { time = 0, dur = 0.05, freq = 2000, q = 1, gain = 0.3 }) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    const len = Math.floor(c.sampleRate * 0.3);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  const t0 = c.currentTime + time;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// 每套主题实现同一组事件：move | capture | check | win | lose | draw
const THEMES = {
  // 木质：常规象棋 App 风格，实木棋子拍在木枰上的「啪嗒」
  wood: {
    move(c) {
      knock(c, { freq: 2300, q: 1.2, dur: 0.04, gain: 0.5 });
      tone(c, { freq: 190, to: 70, dur: 0.08, gain: 0.35 }); // 低频闷响给出“分量”
    },
    capture(c) {
      // 吃子更重：先重拍，再带一记被提走棋子的轻磕
      knock(c, { freq: 1600, q: 1, dur: 0.06, gain: 0.6 });
      tone(c, { freq: 150, to: 55, dur: 0.13, gain: 0.45 });
      knock(c, { freq: 2600, q: 1.5, dur: 0.035, gain: 0.3, time: 0.055 });
    },
    check(c) {
      // 将军：梆子连敲两声
      knock(c, { freq: 1150, q: 7, dur: 0.1, gain: 0.45 });
      knock(c, { freq: 1500, q: 7, dur: 0.14, gain: 0.45, time: 0.14 });
    },
    win(c) {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(c, { freq: f, dur: 0.18, time: i * 0.13, type: "triangle", gain: 0.16 })
      );
    },
    lose(c) {
      [330, 262, 196].forEach((f, i) =>
        tone(c, { freq: f, dur: 0.25, time: i * 0.17, type: "triangle", gain: 0.14 })
      );
    },
    draw(c) {
      knock(c, { freq: 1200, q: 5, dur: 0.1, gain: 0.35 });
      knock(c, { freq: 1200, q: 5, dur: 0.12, gain: 0.35, time: 0.16 });
    },
  },

  // 清脆：玉石/瓷子质感，高频短促
  crisp: {
    move(c) {
      tone(c, { freq: 1500, to: 950, dur: 0.05, gain: 0.22 });
      knock(c, { freq: 5500, q: 1, dur: 0.025, gain: 0.2 });
    },
    capture(c) {
      tone(c, { freq: 1200, to: 600, dur: 0.08, gain: 0.25 });
      tone(c, { freq: 420, to: 180, dur: 0.1, type: "square", gain: 0.1, time: 0.01 });
      knock(c, { freq: 4500, q: 1.5, dur: 0.04, gain: 0.22 });
    },
    check(c) {
      tone(c, { freq: 1318, dur: 0.09, gain: 0.2 });
      tone(c, { freq: 1760, dur: 0.14, time: 0.11, gain: 0.2 });
    },
    win(c) {
      [659, 784, 988, 1318].forEach((f, i) =>
        tone(c, { freq: f, dur: 0.16, time: i * 0.12, gain: 0.16 })
      );
    },
    lose(c) {
      [494, 415, 330].forEach((f, i) =>
        tone(c, { freq: f, dur: 0.22, time: i * 0.16, gain: 0.14 })
      );
    },
    draw(c) {
      tone(c, { freq: 880, dur: 0.12, gain: 0.15 });
      tone(c, { freq: 880, dur: 0.16, time: 0.16, gain: 0.15 });
    },
  },

  // 电子：纯振荡器合成的提示音
  beep: {
    move(c) {
      tone(c, { freq: 900, to: 320, dur: 0.07, type: "triangle", gain: 0.25 });
    },
    capture(c) {
      tone(c, { freq: 480, to: 140, dur: 0.13, type: "square", gain: 0.16 });
      tone(c, { freq: 1200, to: 600, dur: 0.05, time: 0.01, type: "triangle", gain: 0.16 });
    },
    check(c) {
      tone(c, { freq: 880, dur: 0.09, gain: 0.2 });
      tone(c, { freq: 1175, dur: 0.14, time: 0.11, gain: 0.2 });
    },
    win(c) {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(c, { freq: f, dur: 0.16, time: i * 0.12, gain: 0.18 })
      );
    },
    lose(c) {
      [392, 330, 262].forEach((f, i) =>
        tone(c, { freq: f, dur: 0.22, time: i * 0.16, gain: 0.16 })
      );
    },
    draw(c) {
      tone(c, { freq: 440, dur: 0.12, gain: 0.15 });
      tone(c, { freq: 440, dur: 0.16, time: 0.16, gain: 0.15 });
    },
  },
};

// name: move | capture | check | win | lose | draw
export function playSound(name) {
  if (soundMuted()) return;
  const c = audioCtx();
  if (!c) return;
  const theme = THEMES[soundTheme()] || THEMES.wood;
  const fn = theme[name];
  if (fn) fn(c);
}
