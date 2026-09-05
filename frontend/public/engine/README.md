# 浏览器 / Android 本地引擎

项目使用 `ousc/Pikafish-wasm` 的 `wasm-single-simd128` 构建。它在 Web Worker
中运行，Android 模拟器和真机都不需要安装独立引擎，也不占用服务器算力。

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

脚本会自动下载官方 `Pikafish 2023-03-05` 发布包中的匹配权重，也可以通过
`-NnuePath` 指定与该 WASM 源码兼容的其他权重。2026 版 NNUE 架构已经变化，
不能与此 WASM 分支混用。构建依赖正在运行的 Docker Desktop。

许可注意事项：Pikafish 引擎为 GPLv3；分发构建产物时需要同时满足源码与许可
义务。官方 NNUE 权重未经许可不得商用。当前脚本只用于本机开发测试，不会把权重
或构建产物提交到 Git。
