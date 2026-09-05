# 浏览器 / Android 本地引擎

项目使用官方 `official-pikafish/Pikafish` 仓库 `wasm` 分支的
`wasm-single-simd128` 构建，源码锁定在该分支 2023-03-08 的提交
（`ef449fe`）。它在 Web Worker 中运行，Android 模拟器和真机都不需要安装
独立引擎，也不占用服务器算力。

为什么锁定旧提交：`wasm` 分支在 2024-02-26 的顶点（`f6596d1`）更新了 NNUE
读取结构，但官方从未发布与之匹配的权重，所有公开发行权重都会被拒绝加载；
`ef449fe` 是官方权重（2023-03-05 发布包）实际兼容的最新官方源码。

运行时文件：

| 文件 | 来源 |
|------|------|
| `pikafish.worker.js` | 本项目的 UCI Worker 适配器（提交到仓库） |
| `pikafish.js` | Emscripten 构建产物 |
| `pikafish.wasm` | 引擎本体 |
| `pikafish.data` | 构建时打包的 NNUE 权重 |

后三个大文件由 `scripts/build-pikafish-wasm.ps1` 生成，已被 Git 忽略。文件存在
时前端自动启用本地引擎；缺失或启动失败时仍会降级到服务器引擎。

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-pikafish-wasm.ps1
```

脚本会自动下载官方 `Pikafish 2023-03-05` 发布包中的匹配权重。发布包内的
`pikafish.nnue` 本身是 ZIP 容器，WASM 运行时解压不可靠，脚本会先解出内部
原始网络再打包。也可以通过 `-NnuePath` 指定其他权重，但 NNUE 文件内嵌架构
hash，与该 WASM 源码不匹配的版本（如 2023-12、2024-03 及之后的发布权重）
会被引擎拒绝加载。构建依赖正在运行的 Docker Desktop。

许可注意事项：Pikafish 引擎为 GPLv3；分发构建产物时需要同时满足源码与许可
义务。官方 NNUE 权重未经许可不得商用。当前脚本只用于本机开发测试，不会把权重
或构建产物提交到 Git。
