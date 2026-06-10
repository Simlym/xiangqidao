# 浏览器本地引擎目录

把 Pikafish 的 WebAssembly 构建产物放进本目录，前端即自动启用浏览器本地分析
（评估条 / 提示在用户设备上计算，不再请求服务器；缺失时自动降级到服务器引擎）。

需要三个文件（命名必须一致）：

| 文件 | 说明 |
|------|------|
| `pikafish.js`   | Worker 入口脚本（Emscripten 产物） |
| `pikafish.wasm` | 引擎本体 |
| `pikafish.nnue` | 评估网络权重（从 official-pikafish/Networks 获取） |

获取方式：

1. 用 Emscripten 自行编译 Pikafish（`make build ARCH=wasm` 风格的社区构建脚本），
   或使用社区发布的 WASM 版本；
2. 权重下载后改名为 `pikafish.nnue` 放在同目录。

注意：

- 多线程构建依赖 `SharedArrayBuffer`，生产环境需要响应头
  `Cross-Origin-Opener-Policy: same-origin` 和
  `Cross-Origin-Embedder-Policy: require-corp`（开发服务器已配置）；
  单线程构建无此要求，部署最简单。
- 本目录除本说明外的文件已被 git 忽略，引擎产物（数十 MB）不会进仓库。
