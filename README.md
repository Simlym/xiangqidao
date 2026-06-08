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
| 前端 | React + Vite (PWA) | 交叉点棋盘（含楚河汉界/九宫）；训练 / 闯关 / 统计 / 复盘 / 对弈 / 后台；可安装到桌面/主屏 |
| 后端 | FastAPI | 训练调度 / 闯关 / ELO 评分 / 作答 / 统计 / 对弈 / 鉴权 / 后台管理 API |
| 数据 | SQLite（可配置） | `users` `puzzles`(含 ELO `rating`) `reviews`(SM-2) `attempts` `games`(含归属/复盘报告) `game_analysis` `user_stats`(ELO 评分档案)；连接串经 `XQ_DB_URL` 配置 |
| 数据访问 | database + repository 层 | `app/database.py` 管引擎/会话/建表，`app/repository.py` 封装查询，业务路由与 ORM 解耦 |
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
python -m app.importer.load app/importer/seed_puzzles.json       # 种子题（20 道精选）
python -m app.importer.load app/importer/generated_puzzles.json  # 生成器产出（80 道，已校验一步杀）
python -m app.importer.load path/to/puzzles.json --verify        # 装好 pikafish 后逐题校验正解
```

### 扩充题库（针对「题库太少」）

**1. 内置生成器（离线、无需外部数据）** —— 随机布子后用内置规则引擎校验，只留成立的一步杀：
```bash
python -m app.importer.generate --count 100 --seed 1234 --out app/importer/more.json
python -m app.importer.load app/importer/more.json
```
仓库已附带 `generated_puzzles.json`（80 道，全部经 `verify_mate` 校验）。

**2. 可接入的开源题库 / 数据源**（转换成上面的 JSON 即可导入）：

| 来源 | 内容 | 备注 |
|------|------|------|
| [lucaferranti/awesome-xiangqi](https://github.com/lucaferranti/awesome-xiangqi) | 象棋开源资源索引 | 找题库/棋谱的总入口 |
| [maksimKorzh/wukong-xiangqi](https://github.com/maksimKorzh/wukong-xiangqi) | 教学引擎，含 **puzzle generator** / PGN 解析 / 开局库 | 可批量生成题目 |
| 棋弈江湖 Xiangqi PWA（见 awesome 列表） | **7300+ 题库** + 棋盘识别 ONNX 模型（MIT） | 体量最大的开源题库 |
| [walker8088/cchess](https://github.com/walker8088/cchess) | Python 象棋库（FEN/着法/PGN 解析） | 写导入适配器的利器 |
| [official-pikafish/Pikafish](https://github.com/official-pikafish/Pikafish) | 顶尖开源引擎 | 解析名局自动挖掘战术题 + 校验正解 |

> 接入方式：把外部数据的局面/正解转成 `{fen, solution, side_to_move, category, difficulty}` 列表，
> 经 `--verify`（Pikafish）或 `--mate-check`（内置规则）校验后导入。各源的着法记法（WXF/ICCS/UCI）
> 需先归一化到本项目的 UCI 坐标制。

## 测试
```bash
cd backend && python -m pytest tests/ -q
```

## 训练体验

- **难度自适应**：新题按近期首答正确率挑选难度最贴近的题，冷启动偏易。
- **每日新题上限**：到期复习不限，每天新题默认上限 20，防止贪多。
- **分级提示**：同一步错得越多，提示越具体（起点格 → 棋子名 → 完整正解）。
- **变着容错**：终结杀着只要达成将死，等效着法也判对。
- **多步题**：对方应着由系统自动走出，玩家只输入己方着法。
- **计时训练**：实时计时与用时统计，可一键开关。
- **复习日程**：统计页以柱状图展示未来到期复习量（遗忘曲线）。
- **弱点专项**：统计页各杀法旁「去练这类」一键进入该类目专项训练，直击薄弱点。
- **ELO 评分**：每位用户与每道题都有动态评分；首次遇题按强弱差结算，做对强题涨分更多，
  评分只在首次遇题结算（间隔复习不刷分）。统计页展示评分、段位称号、历史最高与排行榜。
- **闯关模式**：公共题库按难度切成依次解锁的关卡，通关解锁下一关，一次做对全关拿三星 ★★★，
  给训练一条清晰的线性进度（题库增长时关卡自动延伸）。
- **复习提醒**：到期复习以顶部横幅 + 浏览器本地通知（需授权）提醒，避免断更打卡；
  站点为 PWA，可「安装到主屏/桌面」离线打开。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `XQ_SECRET` | token 签名密钥；`XQ_ENV=production` 下仍为默认值会拒绝启动 | 开发占位值（仅本地）|
| `XQ_ENV` | 设为 `production` 启用生产校验 | 空 |
| `XQ_ADMIN` | 指定管理员用户名 | `admin` |
| `XQ_DB_URL` | 数据库连接串 | `sqlite:///./data/puzzles.db` |
| `DEEPSEEK_API_KEY` | 复盘逐步失误讲解 + 整局综合复盘报告（可选） | 空（不调用）|

## 鉴权与多用户

- 不登录也能用（数据归属访客 `default`），登录后训练/统计按用户隔离。
- 首位注册用户自动成为**管理员**；也可用环境变量 `XQ_ADMIN=<用户名>` 指定。
- 生产部署务必设置 `XQ_SECRET` 环境变量（token 签名密钥）。
- 管理后台（管理员可见「管理后台」页）：用户管理、题库增删、概览统计。
  新增单步杀法题会用内置规则自动校验是否真为「一步杀」。

## 人机对弈

「人机对弈」页可选先后手与三档难度，与引擎下完整一局；走子受规则约束并提示合法落点，
支持**悔棋**与走子动画。未安装 Pikafish 时使用内置 negamax 搜索，开箱即用。
对局结束**自动存入「复盘」并后台触发分析**，终局面板可**一键跳转复盘本局**；
复盘页除逐步失误外，还给出 LLM **综合复盘报告**，并把实战漏着生成专属练习题（私有），
配合统计页「弱点专项」形成完整闭环：对弈→分析→报告→针对薄弱点再练。

## 路线图

- [x] **第一版**：战术题库 + SM-2 复习 + 统计 + 题库导入/校验
- [x] **第二版**：导入实战棋谱 → Pikafish 复盘 → 输出「本局漏算清单」
- [x] **第三版**：从败局自动生成专属战术题，闭环
- [x] 交叉点棋盘（楚河汉界/九宫/炮兵位）；多类杀法题库 + 内置将死校验
- [x] 登录 + 多用户数据隔离 + 管理后台
- [x] 人机对弈（内置引擎 / Pikafish），含悔棋 / 走子动画 / 对局存盘复盘
- [x] 多步杀法支持对方应着；难度自适应、分级提示、计时训练、复习日程可视化
- [x] 对弈终局自动分析 + 一键复盘；LLM 综合复盘报告；棋局按用户隔离；弱点→题库推荐闭环
- [x] **第一步留存**：ELO 评分 + 段位/排行榜 + 闯关体系 + 复习提醒(PWA 本地通知)；题库生成器扩容
- [ ] 微信小程序获客；服务端推送（Web Push / 微信模板消息）
- [ ] 创作者平台 + 社交；开局/残局课程 + 国际化
- [ ] 残局基础训练；真人对战（联机）
