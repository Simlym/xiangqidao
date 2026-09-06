# 本地引擎库

此目录供开发者存放自行取得的引擎程序、WASM 包和权重文件。除本说明外，目录内容全部被 Git 忽略，也不会进入 Web、PC 或 Android 发行包。

## 目录规范

```text
local-engines/
├── xiangqi/                         # 标准象棋
│   ├── native/                      # PC 客户端或服务器运行的原生程序
│   │   └── <engine-id>/<version>/<platform>/
│   └── wasm/                        # Web/Android 浏览器运行的 WASM 包
│       └── <engine-id>/<version>/<target>/
└── jieqi/                           # 揭棋
    ├── native/
    │   └── <engine-id>/<version>/<platform>/
    └── wasm/
        └── <engine-id>/<version>/<target>/
```

层级含义固定为：**棋种 → 运行时 → 引擎 → 版本 → 平台或构建目标**。

- 棋种只使用 `xiangqi`、`jieqi`。
- 运行时只使用 `native`、`wasm`；不要使用含义不明确的 `local` 或 `server`。
- 引擎目录使用稳定的小写 ID，例如 `pikafish`、`fairy-stockfish`。
- 版本优先使用上游发布日期或版本号；分支构建可使用 `分支名-提交短哈希`。
- 原生平台建议命名为 `windows-x64-bmi2`、`linux-arm64` 等。
- WASM 构建目标建议使用 `browser`、`browser-threads` 等。

## 当前文件

```text
xiangqi/native/pikafish/2026-01-02/windows-x64-bmi2/
xiangqi/wasm/pikafish/legacy/browser/
jieqi/native/pikafish/jieqi-old-23b9466/windows-x64-avxvnni/
jieqi/wasm/                                          # 预留
```

`legacy` 表示版本来源暂未确认，不代表推荐使用。当前目录中的旧版 Pikafish 浏览器产物已补充兼容 Worker 和清单，可以按 `docs/engines/package-spec.md` 导入；新增的 Web/Android 引擎包也必须遵守该规范。
