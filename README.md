# 象棋道 Xiangqidao

一套循序渐进辅助提升中国象棋水平的训练系统。第一版聚焦**战术题训练 + 间隔重复（SM-2）**——
针对业余棋手最大的失分点「漏算」，用可量化的方式回答「我到底有没有进步」。

## 为什么这样设计

业余低段位棋手 90% 的失分来自漏算（没看到吃子、看不到一步杀），而非不懂开局理论。
所以第一版**只做战术题**，刻意推后了收益低的开局变例背诵。核心是一个闭环：

```
练（到期题）→ 答（对/错） → SM-2 调度下次复习 → 统计弱点 → 针对性再练
```

「是否提升」由这些指标量化：各杀法正确率（弱点雷达）、每周正确率趋势、连续打卡、首答正确率。

## 架构

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | React + Vite | 自绘棋盘，点击走子；训练页 + 统计页 |
| 后端 | FastAPI | 训练调度 / 作答 / 统计 API |
| 数据 | SQLite | `puzzles`(题) `reviews`(SM-2状态) `attempts`(作答记录) |
| 复习 | SM-2 | `backend/app/srs.py` |
| 引擎 | Pikafish (可选) | 导入题库时校验正解是否为引擎最优着，过滤脏数据 |

着法采用 UCI 坐标制（如 `h2e2`），与 Pikafish 一致，便于后续接入复盘。

## 运行

### 后端
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.importer.load app/importer/seed_puzzles.json   # 导入种子题库
uvicorn app.main:app --reload --port 8000
```

### 前端
```bash
cd frontend
npm install
npm run dev      # 打开 http://localhost:5173（已代理 /api 到 8000）
```

### 导入更多题库 / 用 Pikafish 校验
```bash
# JSON 格式见 app/importer/seed_puzzles.json
python -m app.importer.load path/to/puzzles.json            # 直接导入
python -m app.importer.load path/to/puzzles.json --verify   # 装好 pikafish 后逐题校验正解
```

## 测试
```bash
cd backend && python -m pytest tests/ -q
```

## 路线图

- [x] **第一版**：战术题库 + SM-2 复习 + 统计 + 题库导入/校验
- [ ] **第二版**：导入实战棋谱 → Pikafish 复盘 → 输出「本局漏算清单」
- [ ] **第三版**：从败局自动生成专属战术题，闭环
- [ ] 残局基础训练；多用户
