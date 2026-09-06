# 不在此目录放置引擎

生产构建会排除整个 `public/engine` 目录。象棋道不包含、下载或分发第三方引擎及其权重。

PC 用户在“设置 → 引擎”中选择本机 UCI 程序。Web 和 Android 用户应在设置页导入符合
[`docs/engines/package-spec.md`](../../../docs/engines/package-spec.md) 的 WASM 引擎包；文件仅保存在设备本地。
