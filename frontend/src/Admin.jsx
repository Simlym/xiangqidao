import React from "react";
import {
  adminAdjustCredits,
  adminCreatePuzzle,
  adminDeletePuzzle,
  adminDeleteUser,
  adminGetEngine,
  adminGetLlmSettings,
  adminInstallEngine,
  adminLogs,
  adminOverview,
  adminPuzzles,
  adminRemoveEngine,
  adminTestLlmSettings,
  adminUpdateLlmSettings,
  adminUserCredits,
  adminUsers,
} from "./api";

const EMPTY = { fen: "", solution: "", category: "未分类", difficulty: 3, side_to_move: "w" };

const TABS = [
  { key: "overview", label: "概览" },
  { key: "users", label: "用户" },
  { key: "puzzles", label: "题库" },
  { key: "settings", label: "系统设置" },
  { key: "logs", label: "日志" },
];

// 后端时间戳为 UTC（无时区后缀），补 Z 再转本地时间显示
const fmtDay = (s) => (s ? new Date(s + "Z").toLocaleDateString() : "—");
const fmtTime = (s) => (s ? new Date(s + "Z").toLocaleString() : "—");

export default function Admin() {
  const [tab, setTab] = React.useState("overview");
  const [ov, setOv] = React.useState(null);
  const [users, setUsers] = React.useState([]);
  const [creditUser, setCreditUser] = React.useState(null); // 正在查看积分详情的用户名

  const reload = React.useCallback(() => {
    adminOverview().then(setOv).catch(() => {});
    adminUsers().then(setUsers).catch(() => {});
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  async function delUser(id) {
    if (!window.confirm("删除该用户及其训练数据？")) return;
    try {
      await adminDeleteUser(id);
      reload();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="admin">
      <div className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 概览卡片 */}
      {tab === "overview" && (
        ov ? (
          <div className="cards">
            <div className="card"><div className="card-value">{ov.users}</div><div className="card-label">用户</div></div>
            <div className="card"><div className="card-value">{ov.puzzles}</div><div className="card-label">题目</div></div>
            <div className="card"><div className="card-value">{ov.games}</div><div className="card-label">棋局</div></div>
            <div className="card"><div className="card-value">{ov.attempts}</div><div className="card-label">作答次数</div></div>
          </div>
        ) : (
          <p className="muted">加载中…</p>
        )
      )}

      {/* 系统设置：对弈引擎 + AI 复盘 */}
      {tab === "settings" && (
        <>
          <EnginePanel />
          <LlmSettingsPanel />
        </>
      )}

      {/* 日志 */}
      {tab === "logs" && <LogsPanel />}

      {/* 用户管理 */}
      {tab === "users" && (
      <div className="panel">
        <h3>用户管理</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          点击「积分」数值可查看流水并手工调整（补偿 / 纠错）。
        </p>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead>
            <tr>
              <th>ID</th><th>用户名</th><th>角色</th><th>注册</th><th>最近登录</th>
              <th>做题ELO</th><th>作答</th><th>已学</th><th>对弈</th><th>连签</th><th>积分</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.username}</td>
                <td>{u.role === "admin" ? <span className="tag">管理员</span> : "用户"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDay(u.created_at)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtTime(u.last_login)}</td>
                <td>{u.rating ?? "—"}</td>
                <td>{u.attempts}</td>
                <td>{u.learned}</td>
                <td>{u.games}</td>
                <td>{u.checkin_streak || "—"}</td>
                <td>
                  <button
                    className="btn-import-submit"
                    style={{ padding: "2px 10px" }}
                    onClick={() => setCreditUser(u.username)}
                  >
                    {u.credits}
                  </button>
                </td>
                <td>
                  <button className="game-delete-btn" onClick={() => delUser(u.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {creditUser && (
          <CreditsModal
            username={creditUser}
            onClose={() => setCreditUser(null)}
            onChanged={reload}
          />
        )}
      </div>
      )}

      {/* 题库管理 */}
      {tab === "puzzles" && <PuzzlesPanel />}
    </div>
  );
}

// 积分流水 kind → 中文标签
function kindLabel(kind) {
  const MAP = {
    "grant:signup": "注册赠送",
    "admin:adjust": "管理员调整",
    "earn:checkin": "签到",
    "earn:game": "对弈奖励",
    "earn:puzzle": "做题奖励",
  };
  if (MAP[kind]) return MAP[kind];
  if (kind.startsWith("spend:")) return "消耗";
  if (kind.startsWith("refund:")) return "退回";
  return kind;
}

function CreditsModal({ username, onClose, onChanged }) {
  const [data, setData] = React.useState(null);
  const [delta, setDelta] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    adminUserCredits(username).then(setData).catch((e) => setErr(e.message));
  }, [username]);

  async function adjust(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) {
      setErr("请输入非 0 整数，负数为扣减");
      return;
    }
    try {
      const next = await adminAdjustCredits(username, d, reason.trim());
      setData(next);
      setDelta("");
      setReason("");
      setMsg(`已调整 ${d > 0 ? "+" : ""}${d}，当前余额 ${next.balance}`);
      onChanged?.(); // 刷新用户列表里的余额
    } catch (e2) {
      setErr(e2.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3 style={{ margin: 0 }}>积分 · {username}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {data && (
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            余额 <b>{data.balance}</b> ・ 累计获取 {data.total_earned}
            ・ 连签 {data.checkin_streak} 天
            {data.last_checkin ? ` ・ 最近签到 ${data.last_checkin}` : ""}
          </p>
        )}

        <form className="import-row" onSubmit={adjust} style={{ alignItems: "center" }}>
          <input
            className="import-input"
            style={{ maxWidth: 120 }}
            placeholder="如 100 / -50"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
          <input
            className="import-input"
            placeholder="原因（计入审计日志）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn-import-submit" type="submit">调整</button>
        </form>
        {err && <div className="import-error">{err}</div>}
        {msg && <div style={{ color: "#27ae60", fontSize: 13 }}>{msg}</div>}

        <div className="admin-table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>备注</th></tr>
            </thead>
            <tbody>
              {(data?.logs || []).map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.ts}</td>
                  <td>{kindLabel(r.kind)}</td>
                  <td style={{ color: r.amount >= 0 ? "#27ae60" : "#c0392b" }}>
                    {r.amount > 0 ? `+${r.amount}` : r.amount}
                  </td>
                  <td>{r.balance_after}</td>
                  <td>{r.ref || "—"}</td>
                </tr>
              ))}
              {data && data.logs.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: "center" }}>暂无流水</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const PUZZLE_PAGE = 20;

function PuzzlesPanel() {
  const [data, setData] = React.useState({ total: 0, categories: [], items: [] });
  const [category, setCategory] = React.useState("");
  const [difficulty, setDifficulty] = React.useState(0);
  const [qInput, setQInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [showAdd, setShowAdd] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");

  // 搜索防抖
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = React.useCallback(() => {
    adminPuzzles({ limit: PUZZLE_PAGE, offset, category, difficulty, q })
      .then(setData)
      .catch(() => {});
  }, [offset, category, difficulty, q]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function delPuzzle(id) {
    if (!window.confirm("删除该题目？")) return;
    try {
      await adminDeletePuzzle(id);
      // 删掉本页最后一条时回到上一页，否则原地刷新
      if (data.items.length === 1 && offset > 0) setOffset((o) => o - PUZZLE_PAGE);
      else load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function addPuzzle(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    try {
      await adminCreatePuzzle({ ...form, difficulty: Number(form.difficulty), mate_check: true });
      setMsg("添加成功，已通过将死校验");
      setForm(EMPTY);
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const page = Math.floor(offset / PUZZLE_PAGE) + 1;
  const pages = Math.max(1, Math.ceil(data.total / PUZZLE_PAGE));
  const filtered = category || difficulty || q;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>题库（{data.total}）</h3>
        <button
          className="btn-import-submit"
          onClick={() => { setShowAdd(true); setMsg(""); setErr(""); }}
        >
          ＋ 新增题目
        </button>
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3 style={{ margin: 0 }}>新增战术题</h3>
              <button className="modal-close" onClick={() => setShowAdd(false)}>×</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>单步杀法会自动做将死校验。</p>
            <form className="admin-form" onSubmit={addPuzzle}>
              <input className="import-input" name="fen" placeholder="FEN，如 4k4/R8/8R/9/9/9/9/9/9/3K5"
                     value={form.fen} onChange={change} />
              <div className="import-row">
                <input className="import-input" name="solution" placeholder="正解 UCI，如 i7i9（多步逗号分隔）"
                       value={form.solution} onChange={change} />
                <select className="import-input" name="side_to_move" value={form.side_to_move} onChange={change}>
                  <option value="w">红方走</option>
                  <option value="b">黑方走</option>
                </select>
              </div>
              <div className="import-row">
                <input className="import-input" name="category" placeholder="分类，如 双车错"
                       value={form.category} onChange={change} />
                <select className="import-input" name="difficulty" value={form.difficulty} onChange={change}>
                  {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>难度 {d}</option>)}
                </select>
              </div>
              {err && <div className="import-error">{err}</div>}
              {msg && <div style={{ color: "#27ae60", fontSize: 13 }}>{msg}</div>}
              <button className="btn-import-submit" type="submit">添加题目</button>
            </form>
          </div>
        </div>
      )}

      {/* 筛选工具栏 */}
      <div className="puzzle-filter">
        <input
          className="import-input"
          placeholder="搜索 ID / 分类 / 正解 / FEN"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <select
          className="import-input"
          value={category}
          onChange={(e) => { setCategory(e.target.value); setOffset(0); }}
        >
          <option value="">全部分类</option>
          {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="import-input"
          value={difficulty}
          onChange={(e) => { setDifficulty(Number(e.target.value)); setOffset(0); }}
        >
          <option value={0}>全部难度</option>
          {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>难度 {d}</option>)}
        </select>
        {filtered && (
          <button
            type="button"
            className="game-delete-btn"
            style={{ width: "auto", padding: "0 12px" }}
            onClick={() => { setQInput(""); setQ(""); setCategory(""); setDifficulty(0); setOffset(0); }}
          >
            清除筛选
          </button>
        )}
      </div>

      <div className="admin-table-wrap"><table className="admin-table">
        <thead>
          <tr><th>ID</th><th>分类</th><th>难度</th><th>正解</th><th>来源</th><th>校验</th><th></th></tr>
        </thead>
        <tbody>
          {data.items.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.category}</td>
              <td>{"★".repeat(p.difficulty)}</td>
              <td><code>{p.solution}</code></td>
              <td>{p.source}</td>
              <td>{p.verified ? "✓" : "—"}</td>
              <td><button className="game-delete-btn" onClick={() => delPuzzle(p.id)}>×</button></td>
            </tr>
          ))}
          {data.items.length === 0 && (
            <tr><td colSpan={7} className="muted" style={{ textAlign: "center" }}>
              {filtered ? "没有匹配的题目" : "题库为空"}
            </td></tr>
          )}
        </tbody>
      </table></div>

      <div className="import-row" style={{ marginTop: 10, alignItems: "center" }}>
        <button
          className="btn-import-submit"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PUZZLE_PAGE))}
        >
          上一页
        </button>
        <span className="muted" style={{ fontSize: 13 }}>第 {page} / {pages} 页</span>
        <button
          className="btn-import-submit"
          disabled={offset + PUZZLE_PAGE >= data.total}
          onClick={() => setOffset((o) => o + PUZZLE_PAGE)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

const OS_LABEL = { windows: "Windows", macos: "macOS", linux: "Linux" };
const BUSY_STATES = ["downloading", "extracting", "verifying"];

function fmtMB(n) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

function EnginePanel() {
  const [st, setSt] = React.useState(null);
  const [variant, setVariant] = React.useState(""); // "" = 自动
  const [err, setErr] = React.useState("");

  const load = React.useCallback(() => {
    adminGetEngine().then(setSt).catch(() => {});
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // 安装进行中时轮询进度
  const busy = st && BUSY_STATES.includes(st.state);
  React.useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [busy, load]);

  if (!st) return null;

  async function install() {
    setErr("");
    try {
      const r = await adminInstallEngine(variant);
      if (r.started === false) setErr(r.reason || "无法启动安装");
      setSt(r);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function remove() {
    if (!window.confirm("卸载已安装的 Pikafish？将回退到 PATH / 内置引擎。")) return;
    setErr("");
    try {
      setSt(await adminRemoveEngine());
    } catch (e) {
      setErr(e.message);
    }
  }

  const meta = st.meta;
  const pct = st.total > 0 ? Math.round((st.downloaded / st.total) * 100) : null;

  let current;
  if (st.installed && meta) {
    current = `已安装 Pikafish ${meta.version}（${meta.variant}）`;
  } else if (st.on_path) {
    current = "检测到 PATH 中的 Pikafish";
  } else {
    current = "未安装，当前使用内置搜索引擎";
  }

  return (
    <div className="panel">
      <h3>对弈引擎（Pikafish）</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        从官方 Release 一键下载安装强力引擎，提升人机对弈棋力、局面评分与复盘分析的准确度。
        无需配置 PATH，安装后即时生效。
      </p>

      <div className="import-row" style={{ alignItems: "center", marginBottom: 8 }}>
        <span className={"tag" + (st.installed || st.on_path ? "" : " muted")}>
          {st.installed || st.on_path ? "● " : "○ "}
          {current}
        </span>
        <span className="muted" style={{ fontSize: 13 }}>
          本机：{OS_LABEL[st.os] || st.os} / {st.arch}
        </span>
      </div>

      {busy && (
        <div style={{ margin: "8px 0" }}>
          <div className="eval-bar" style={{ height: 16 }}>
            <div className="eval-bar-red" style={{ width: `${pct ?? 30}%`, background: "#2e7d32" }} />
            <span className="eval-bar-value">
              {st.state === "downloading"
                ? pct != null
                  ? `下载中 ${pct}%（${fmtMB(st.downloaded)}/${fmtMB(st.total)}）`
                  : `下载中 ${fmtMB(st.downloaded)}`
                : st.message}
            </span>
          </div>
        </div>
      )}

      {!busy && st.state === "done" && (
        <div style={{ color: "#27ae60", fontSize: 13, margin: "4px 0" }}>{st.message}</div>
      )}
      {!busy && st.state === "error" && (
        <div className="import-error">{st.error || st.message}</div>
      )}

      <div className="import-row" style={{ marginTop: 8, alignItems: "center" }}>
        <select
          className="import-input"
          value={variant}
          disabled={busy}
          onChange={(e) => setVariant(e.target.value)}
        >
          <option value="">自动（最兼容）</option>
          {(st.variants || []).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <button className="btn-import-submit" disabled={busy} onClick={install}>
          {busy ? (
            <>
              <span className="btn-spinner" />
              安装中
            </>
          ) : st.installed ? (
            "更新到最新版"
          ) : (
            "下载并安装"
          )}
        </button>
        {st.installed && (
          <button
            className="game-delete-btn"
            style={{ width: "auto", padding: "0 12px" }}
            disabled={busy}
            onClick={remove}
          >
            卸载
          </button>
        )}
      </div>

      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        若自检提示与 CPU 不兼容，请在上方下拉选择更兼容的变体（如含 <code>sse41</code> / <code>ssse3</code>）后重试。
        变体列表在首次下载后出现。
      </p>

      {err && <div className="import-error">{err}</div>}
    </div>
  );
}

function LlmSettingsPanel() {
  const [cfg, setCfg] = React.useState(null);
  const [keyInput, setKeyInput] = React.useState(""); // 仅在用户输入新密钥时使用
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    adminGetLlmSettings().then(setCfg).catch(() => {});
  }, []);

  if (!cfg) return null;

  async function save(patch) {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const next = await adminUpdateLlmSettings(patch);
      setCfg(next);
      setKeyInput("");
      setMsg("已保存");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const r = await adminTestLlmSettings();
      setMsg(`连接正常，模型回复：${r.reply}`);
    } catch (e) {
      setErr(`测试失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>AI 复盘设置（DeepSeek）</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        开启后，复盘时会调用大模型生成失误讲解与整局总评。
        密钥也可用环境变量 <code>DEEPSEEK_API_KEY</code> 配置，此处填写优先生效。
      </p>

      <div className="import-row" style={{ alignItems: "center", marginBottom: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            disabled={busy}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          启用 AI 复盘
        </label>
        <span className={"tag" + (cfg.active ? "" : " muted")}>
          {cfg.active ? "● 已生效" : cfg.has_key ? "○ 已配置但未启用" : "○ 未配置密钥"}
        </span>
      </div>

      <div className="import-row">
        <input
          className="import-input"
          type="password"
          placeholder={cfg.has_key ? `已配置（${cfg.key_hint}），留空则不变` : "填入 DeepSeek API Key"}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
        />
        <select
          className="import-input"
          value={cfg.model}
          disabled={busy}
          onChange={(e) => save({ model: e.target.value })}
        >
          <option value="deepseek-chat">deepseek-chat</option>
          <option value="deepseek-reasoner">deepseek-reasoner</option>
        </select>
      </div>

      <div className="import-row" style={{ marginTop: 8 }}>
        <button
          className="btn-import-submit"
          disabled={busy || !keyInput.trim()}
          onClick={() => save({ api_key: keyInput.trim() })}
        >
          保存密钥
        </button>
        {cfg.has_key && (
          <button
            className="game-delete-btn"
            style={{ width: "auto", padding: "0 12px" }}
            disabled={busy}
            onClick={() => save({ api_key: "" })}
          >
            清除密钥
          </button>
        )}
        <button className="btn-import-submit" disabled={busy} onClick={test}>
          测试连接
        </button>
      </div>

      {err && <div className="import-error">{err}</div>}
      {msg && <div style={{ color: "#27ae60", fontSize: 13 }}>{msg}</div>}
    </div>
  );
}

const LOG_FILTERS = [
  { key: "", label: "全部" },
  { key: "login_failed", label: "登录失败" },
  { key: "admin_action", label: "管理操作" },
];
const EVENT_LABEL = { login_failed: "登录失败", admin_action: "管理操作" };
const PAGE = 50;

function LogsPanel() {
  const [rows, setRows] = React.useState([]);
  const [filter, setFilter] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    adminLogs(PAGE, offset, filter)
      .then(setRows)
      .catch((e) => setErr(e.message));
  }, [filter, offset]);

  const pickFilter = (key) => {
    setFilter(key);
    setOffset(0);
  };

  return (
    <div className="panel">
      <h3>安全审计日志</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        记录登录失败与管理员敏感操作（删用户、删题、改 AI 设置），不含密码、密钥等敏感值。
      </p>

      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        {LOG_FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? "active" : ""}
            onClick={() => pickFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {err && <div className="import-error">{err}</div>}

      <div className="admin-table-wrap"><table className="admin-table">
        <thead>
          <tr><th>时间</th><th>类型</th><th>IP</th><th>用户/操作者</th><th>动作</th><th>目标</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: "nowrap" }}>{r.ts}</td>
              <td>
                <span className={"tag" + (r.level === "warning" ? "" : " muted")}>
                  {EVENT_LABEL[r.event] || r.event}
                </span>
              </td>
              <td><code>{r.ip}</code></td>
              <td>{r.actor || "—"}</td>
              <td>{r.action || "—"}</td>
              <td>{r.target || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="muted" style={{ textAlign: "center" }}>暂无日志</td></tr>
          )}
        </tbody>
      </table></div>

      <div className="import-row" style={{ marginTop: 10, alignItems: "center" }}>
        <button
          className="btn-import-submit"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
        >
          上一页
        </button>
        <span className="muted" style={{ fontSize: 13 }}>第 {offset / PAGE + 1} 页</span>
        <button
          className="btn-import-submit"
          disabled={rows.length < PAGE}
          onClick={() => setOffset((o) => o + PAGE)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
