# 象棋道 WASM UCI 引擎包规范 v1

引擎包应先解压为一个目录。目录根部必须包含 `engine-manifest.json`，入口必须是可由 Web Worker
直接加载并通过 `postMessage` 接收、返回逐行 UCI 文本的 JavaScript 文件。入口使用相对路径加载的
WASM、胶水代码和数据文件也必须包含在同一目录中。

```json
{
  "schemaVersion": 1,
  "id": "example-engine",
  "name": "示例 UCI 引擎",
  "version": "1.0.0",
  "variant": "xiangqi",
  "protocol": "uci",
  "runtime": "wasm",
  "entrypoint": "engine.worker.js",
  "assets": [
    { "path": "engine.js", "role": "runtime" },
    { "path": "engine.wasm", "role": "wasm" },
    { "path": "network.nnue", "role": "evaluation-network" }
  ],
  "sourceUrl": "https://example.invalid/source",
  "licenseUrl": "https://example.invalid/license"
}
```

`variant` 只能是 `xiangqi` 或 `jieqi`。独立权重不是必需项；不需要权重或已内置权重的引擎可以省略
`evaluation-network`。当前限制为最多 40 个文件、解压后合计不超过 256 MB。

导入器不会执行下载、解压或许可判断，只验证清单、文件集合和棋种。首次导入后如果 Service Worker
尚未控制当前页面，需要刷新一次。
