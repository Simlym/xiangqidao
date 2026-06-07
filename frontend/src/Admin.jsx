import React from "react";
import {
  adminCreatePuzzle,
  adminDeletePuzzle,
  adminDeleteUser,
  adminOverview,
  adminPuzzles,
  adminUsers,
} from "./api";

const EMPTY = { fen: "", solution: "", category: "未分类", difficulty: 3, side_to_move: "w" };

export default function Admin() {
  const [ov, setOv] = React.useState(null);
  const [users, setUsers] = React.useState([]);
  const [puzzles, setPuzzles] = React.useState([]);
  const [form, setForm] = React.useState(EMPTY);
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");

  const reload = React.useCallback(() => {
    adminOverview().then(setOv).catch(() => {});
    adminUsers().then(setUsers).catch(() => {});
    adminPuzzles().then(setPuzzles).catch(() => {});
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

  async function delPuzzle(id) {
    if (!window.confirm("删除该题目？")) return;
    await adminDeletePuzzle(id);
    reload();
  }

  async function addPuzzle(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    try {
      await adminCreatePuzzle({ ...form, difficulty: Number(form.difficulty), mate_check: true });
      setMsg("添加成功，已通过将死校验");
      setForm(EMPTY);
      reload();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <div className="admin">
      {/* 概览卡片 */}
      {ov && (
        <div className="cards">
          <div className="card"><div className="card-value">{ov.users}</div><div className="card-label">用户</div></div>
          <div className="card"><div className="card-value">{ov.puzzles}</div><div className="card-label">题目</div></div>
          <div className="card"><div className="card-value">{ov.games}</div><div className="card-label">棋局</div></div>
          <div className="card"><div className="card-value">{ov.attempts}</div><div className="card-label">作答次数</div></div>
        </div>
      )}

      {/* 用户管理 */}
      <div className="panel">
        <h3>用户管理</h3>
        <table className="admin-table">
          <thead>
            <tr><th>ID</th><th>用户名</th><th>角色</th><th>作答</th><th>已学</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.username}</td>
                <td>{u.role === "admin" ? <span className="tag">管理员</span> : "用户"}</td>
                <td>{u.attempts}</td>
                <td>{u.learned}</td>
                <td>
                  <button className="game-delete-btn" onClick={() => delUser(u.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新增题目 */}
      <div className="panel">
        <h3>新增战术题（单步杀法自动校验）</h3>
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

      {/* 题库列表 */}
      <div className="panel">
        <h3>题库（{puzzles.length}）</h3>
        <table className="admin-table">
          <thead>
            <tr><th>ID</th><th>分类</th><th>难度</th><th>正解</th><th>校验</th><th></th></tr>
          </thead>
          <tbody>
            {puzzles.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.category}</td>
                <td>{"★".repeat(p.difficulty)}</td>
                <td><code>{p.solution}</code></td>
                <td>{p.verified ? "✓" : "—"}</td>
                <td><button className="game-delete-btn" onClick={() => delPuzzle(p.id)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
