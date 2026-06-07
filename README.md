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
| 前端 | React + Vite | 交叉点棋盘（含楚河汉界/九宫）；训练 / 统计 / 复盘 / 对弈 / 后台 |
| 后端 | FastAPI | 训练调度 / 作答 / 统计 / 对弈 / 鉴权 / 后台管理 API |
| 数据 | SQLite | `users` `puzzles` `reviews`(SM-2) `attempts` `games` |
| 复习 | SM-2 | `backend/app/srs.py` |
| 鉴权 | 标准库自实现 | PBKDF2 密码哈希 + HMAC 签名 token，无第三方依赖（`app/auth.py`）|
| 杀法校验 | 内置规则引擎 | `app/importer/verify_mate.py` 判定将军/将死，校验一步杀题，无需 Pikafish |
| 对弈引擎 | 内置 negamax / Pikafish | 装了 Pikafish 用之，否则回退内置 alpha-beta 搜索（`app/play_engine.py`）|
| 分析引擎 | Pikafish (可选) | 复盘逐步分析；导入题库时校验正解 |

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

## 鉴权与多用户

- 不登录也能用（数据归属访客 `default`），登录后训练/统计按用户隔离。
- 首位注册用户自动成为**管理员**；也可用环境变量 `XQ_ADMIN=<用户名>` 指定。
- 生产部署务必设置 `XQ_SECRET` 环境变量（token 签名密钥）。
- 管理后台（管理员可见「管理后台」页）：用户管理、题库增删、概览统计。
  新增单步杀法题会用内置规则自动校验是否真为「一步杀」。

## 人机对弈

「人机对弈」页可选先后手与三档难度，与引擎下完整一局；走子受规则约束并提示合法落点。
未安装 Pikafish 时使用内置 negamax 搜索，开箱即用。

## 路线图

- [x] **第一版**：战术题库 + SM-2 复习 + 统计 + 题库导入/校验
- [x] **第二版**：导入实战棋谱 → Pikafish 复盘 → 输出「本局漏算清单」
- [x] **第三版**：从败局自动生成专属战术题，闭环
- [x] 交叉点棋盘（楚河汉界/九宫/炮兵位）；多类杀法题库 + 内置将死校验
- [x] 登录 + 多用户数据隔离 + 管理后台
- [x] 人机对弈（内置引擎 / Pikafish）
- [ ] 残局基础训练；真人对战（联机）；多步杀法支持对方应着
