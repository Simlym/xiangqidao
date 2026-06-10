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
| 对弈引擎 | 云库 + 内置 negamax / Pikafish | 开局优先查云库（秒回、省 CPU），其后 Pikafish，未装则回退内置 alpha-beta 搜索（`app/play_engine.py` `app/cloudbook.py`）|
| 分析引擎 | Pikafish (可选) | 复盘逐步分析；导入题库时校验正解 |
| 浏览器引擎 | Pikafish WASM (可选) | 评估条/提示在用户浏览器内计算，服务器零开销；未放置产物时自动降级到服务器（`frontend/src/localEngine.js`）|
| 云库 | 在线棋谱库代理 | 后端代理 + TTL 缓存 + 失败熔断；前端「云库」面板展示着法/评分/胜率（`app/cloudbook.py`）|

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

### 安装 Pikafish（可选，强力引擎）

不装也能用：对弈与评分会自动回退到内置 negamax 搜索。装上 [Pikafish](https://github.com/official-pikafish/Pikafish)（顶尖开源象棋引擎）后，**人机对弈棋力、局面评分、复盘分析都会显著变强更准**。

后端按「**受管目录 `data/engine/` 优先，其次 `PATH`**」顺序自动探测引擎（`app/engine.py:find_engine`）。

#### 方式一：管理后台一键安装（推荐）

登录**管理员**账号 → 「管理后台 → 对弈引擎（Pikafish）」→ 点「下载并安装」。系统会：

1. 识别当前操作系统（Windows / macOS / Linux）；
2. 从官方 Release 下载发布包，自动挑选**最兼容**的可执行文件（避免 CPU 指令集不支持而崩溃）；
3. 连同 `pikafish.nnue` 权重装入 `data/engine/`，启动自检通过后**即时生效**（无需改 PATH、无需重启）。

若自检提示与 CPU 不兼容，可在下拉里改选更兼容的变体（如含 `sse41` / `ssse3`）重试。装毕「人机对弈」页引擎标签会变为 `♟ Pikafish`。可用 `XQ_ENGINE_DIR` 自定义受管目录。

> 该功能仅管理员可见、只从官方仓库 `official-pikafish/Pikafish` 拉取。

#### 方式二：手动安装（自行放入 PATH）

**1. 获取可执行文件**（任选其一）

- **下载预编译版**：到 [Releases](https://github.com/official-pikafish/Pikafish/releases) 下载对应平台的压缩包，里面含可执行文件与权重文件 `pikafish.nnue`。
- **从源码编译**：
  ```bash
  git clone https://github.com/official-pikafish/Pikafish.git
  cd Pikafish/src && make -j build ARCH=x86-64-modern   # 按机器架构调整 ARCH
  # 编译产物为 src/pikafish，并需配套 pikafish.nnue 权重文件
  ```

**2. 放到 PATH，并让它找得到权重文件 `pikafish.nnue`**

Pikafish 启动时默认在**可执行文件同目录**加载 `pikafish.nnue`，请把两者放在一起。

- **Linux / macOS**：
  ```bash
  sudo cp pikafish pikafish.nnue /usr/local/bin/   # 同目录放置二进制与权重
  sudo chmod +x /usr/local/bin/pikafish
  which pikafish                                    # 验证可被发现
  ```
- **Windows**（PowerShell）：把 `pikafish.exe` 与 `pikafish.nnue` 放进同一目录（如 `C:\tools\pikafish\`），再将该目录加入 PATH：
  ```powershell
  $env:Path += ";C:\tools\pikafish"          # 当前会话临时生效
  # 永久生效：系统设置 → 环境变量 → 在 Path 中新增该目录
  (Get-Command pikafish).Source              # 验证可被发现
  ```

**3. 验证**

```bash
echo "uci" | pikafish        # 应输出 id / option 列表并以 uciok 结尾
```

重启后端后，「人机对弈」页右上角的引擎标签会从 `♟ 内置引擎` 变为 `♟ Pikafish`，设置页也会提示「评分较准」。

> 找不到引擎时多为：未加入 PATH、缺少 `pikafish.nnue`、或可执行权限不足。后端探测一次后会记住结果，改动后请**重启后端进程**再试。

### 浏览器本地引擎（可选，评估/提示零服务器开销）

把 Pikafish 的 **WebAssembly 构建**放进 `frontend/public/engine/`（三个文件：
`pikafish.js` / `pikafish.wasm` / `pikafish.nnue`，详见该目录 README），前端会自动探测并启用：

- 对弈页的**评估条**与**提示**改在用户浏览器内计算，不再请求服务器；
- 引擎标签出现 `⚡ 本地分析`；加载失败/文件缺失时自动降级到服务器接口，功能不受影响；
- 多线程构建需要服务器响应头 `Cross-Origin-Opener-Policy: same-origin` 与
  `Cross-Origin-Embedder-Policy: require-corp`（Vite 开发服务器已配置，生产环境在 Nginx 等处添加）；单线程构建无此要求。

### 云库（在线开局库）

默认开启，无需配置。对弈引擎在**开局阶段**（默认前 12 回合）优先采用云库着法——
秒回且质量高，同时省下一次引擎搜索；前端对弈页新增「云库」面板，可查看当前局面的
库着法（评分/胜率，点击直接走子）与「提示」按钮（本地引擎 → 云库 → 服务器引擎逐级降级）。

后端做了统一代理：进程内 TTL 缓存（开局局面高度重复）、连续失败自动熔断，
网络不可用时静默降级，不影响对弈。环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `XQ_CLOUDBOOK` | `1` | 设为 `0` 完全关闭云库 |
| `XQ_CLOUDBOOK_URL` | chessdb 公共云库 | 查询接口地址 |
| `XQ_CLOUDBOOK_TIMEOUT` | `1.5` | 单次查询超时（秒） |
| `XQ_CLOUDBOOK_MAX_PLY` | `24` | 引擎参考云库的最大半着数 |

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

> 接入方式：把外部数据的局面/正解转成 `{fen, solution, side_to_move, kind, category, difficulty, steps}` 列表，
> 经 `--verify`（Pikafish）或 `--mate-check`（内置规则）校验后导入。各源的着法记法（WXF/ICCS/UCI）
> 需先归一化到本项目的 UCI 坐标制。

**3. 一键接入 wukong-xiangqi 实战杀局（已内置适配器）** —— 该开源库约 3386 道取自世界
象棋锦标赛等实战的杀局，**仅含局面与「Mate in N」标注、无题解着法**。`import_wukong` 用内置
规则引擎离线搜索强制连将杀、补出正解，并自动按杀法名目（卧槽马/双车错/重炮…）分类、按步数定
难度：
```bash
# 下载题源 → 求解 → 分类 → 产出本系统可导入的 JSON（可加 --limit 先小批量试跑）
python -m app.importer.import_wukong --out app/importer/wukong_puzzles.json
python -m app.importer.load app/importer/wukong_puzzles.json
```
> 「先弃后杀 / 安静着造杀」等非连续将军的题无法被纯将军搜索求解，会被跳过——保证导入的每题
> 都是经 `verify_mate` 验证成立的连将杀。仓库已附带产出的 `wukong_puzzles.json`。

### 题库分类体系（两级 + 难度 + 步数）

| 字段 | 含义 | 取值示例 |
|------|------|----------|
| `kind` | 大类 | 杀法 / 开局 / 中局 / 残局 |
| `category` | 具体名目 | 卧槽马、马后炮、双车错、对面笑、重炮、炮杀、车杀、兵杀… |
| `difficulty` | 难度 | 1–5（杀法题按步数映射） |
| `steps` | 解题回合数 | mate-in-N 的 N |

训练取题 `/api/training/next` 支持 `kind`（大类专项）或 `category`（名目专项）筛选；
`/api/stats/catalog` 返回题库目录（各名目题数 / 已学数）供前端浏览与专项练习选择。

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
| `XQ_ENV` | 设为 `production` 启用生产校验，并关闭 `/docs`、`/openapi.json` | 空 |
| `XQ_ADMIN` | 指定管理员用户名；**留空时只有首位注册者成为管理员**（推荐公网部署留空，避免 `admin` 用户名被抢注提权）| 空 |
| `XQ_ORIGINS` | 允许的前端来源（CORS），逗号分隔，如 `https://xq.example.com`；留空则放开（仅限本地开发）| 空（`*`）|
| `XQ_DB_URL` | 数据库连接串 | `sqlite:///./data/puzzles.db` |
| `XQ_ENGINE_DIR` | 管理后台一键安装 Pikafish 的受管目录（发现引擎时优先于 PATH）| `./data/engine` |
| `DEEPSEEK_API_KEY` | 复盘逐步失误讲解 + 整局综合复盘报告（可选）；也可在「管理后台 → AI 复盘设置」中配置，后台填写优先生效 | 空（不调用）|

## 公网部署安全清单

上线前请逐项确认：

- **必设环境变量**：`XQ_ENV=production`、`XQ_SECRET=$(openssl rand -hex 32)`、`XQ_ORIGINS=<你的前端域名>`；`XQ_ADMIN` 留空。
- **HTTPS**：放在 nginx / Caddy 等反向代理后并强制 TLS（Bearer token 走明文会被截获），开启 HSTS。
- **限流取真实 IP**：登录/注册、对弈与分析接口已内置基于 IP 的限流。部署在反代后须以
  `uvicorn app.main:app --proxy-headers --forwarded-allow-ips="<反代IP>"` 启动，否则限流会把所有人算作同一 IP。
- **安全响应头**：在反代层补 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、合适的 CSP。
- **审计日志**：失败登录与管理员敏感操作会写入 `xiangqidao.security` logger（继承 uvicorn 处理器），
  确保 uvicorn 日志落盘并配置轮转；日志**不含**密码 / token / API key。
- **数据库**：sqlite 文件权限收紧（仅运行账户可读写），备份注意 `app_settings` 中的 DeepSeek 密钥脱敏。

## 鉴权与多用户

- 不登录也能用（数据归属访客 `default`），登录后训练/统计按用户隔离。
- 首位注册用户自动成为**管理员**；也可用环境变量 `XQ_ADMIN=<用户名>` 指定（留空时仅首位注册者为管理员）。
- 生产部署务必设置 `XQ_SECRET` 环境变量（token 签名密钥）。
- 管理后台（管理员可见「管理后台」页）：用户管理、题库增删、概览统计、AI 复盘开关与密钥配置、
  **Pikafish 引擎一键安装/更新**。新增单步杀法题会用内置规则自动校验是否真为「一步杀」。

## 人机对弈

「人机对弈」页可选先后手与三档难度，与引擎下完整一局；走子受规则约束并提示合法落点，
支持**悔棋**与走子动画。未安装 Pikafish 时使用内置 negamax 搜索，开箱即用
（状态栏会显示当前引擎 `♟ Pikafish` / `♟ 内置引擎`，见[安装 Pikafish](#安装-pikafish可选强力引擎)）。
可一键开启**优劣势评估条**：以红方视角实时显示局面分（如 `+1.2` / `+M3`）与优劣措辞，
评分精度取决于当前引擎。
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
