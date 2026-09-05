[CmdletBinding()]
param(
    [string]$NnuePath = "",
    [string]$SourceDirectory = ".wasm-build-src",
    [string]$OutputDirectory = "frontend\public\engine"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = [IO.Path]::GetFullPath((Join-Path $projectRoot $SourceDirectory))
$outputPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is not ready. Start it and try again."
}

# 官方仓库 wasm 分支在 2023-03-08 的提交。该分支后续提交（f6596d1 起）更新了
# NNUE 读取结构，但官方从未发布与之匹配的权重，所有公开发布包均会被拒绝加载；
# 因此锁定到这个与 2023-03-05 官方权重兼容的历史提交。
$pinnedCommit = "ef449fee0c1c4d5cf6edce966bd051db8745f7c8"
$repoUrl = "https://github.com/official-pikafish/Pikafish.git"

if (-not (Test-Path -LiteralPath (Join-Path $sourcePath "src\Makefile"))) {
    git clone --depth 1 --branch wasm $repoUrl $sourcePath
    if ($LASTEXITCODE -ne 0) { throw "Failed to clone Pikafish WASM source." }
}
# 浅克隆默认只有分支顶点；按需抓取锁定提交并切换（直接用官方 URL，
# 不依赖 remote 名称）。
git -C $sourcePath fetch --depth 1 $repoUrl $pinnedCommit
if ($LASTEXITCODE -ne 0) { throw "Failed to fetch pinned commit $pinnedCommit." }
git -C $sourcePath checkout --force $pinnedCommit
if ($LASTEXITCODE -ne 0) { throw "Failed to checkout pinned commit $pinnedCommit." }

if ($NnuePath) {
    $networkPath = [IO.Path]::GetFullPath($NnuePath)
} else {
    $releaseDirectory = Join-Path $sourcePath "release-2023-03-05"
    $networkPath = Join-Path $releaseDirectory "pikafish.nnue"
    if (-not (Test-Path -LiteralPath $networkPath -PathType Leaf)) {
        $releaseZip = Join-Path $sourcePath "Pikafish.2023-03-05.zip"
        Invoke-WebRequest `
            -Uri "https://github.com/official-pikafish/Pikafish/releases/download/Pikafish-2023-03-05/Pikafish.2023-03-05.zip" `
            -OutFile $releaseZip
        Expand-Archive -LiteralPath $releaseZip -DestinationPath $releaseDirectory -Force
    }
    # 发布包内的 pikafish.nnue 本身是 ZIP 容器（PK 头）。WASM 运行时对压缩权重
    # 的解压路径不可靠，因此打包前统一解出内部原始网络再使用。
    $magic = [System.IO.File]::ReadAllBytes($networkPath)[0..1]
    if ($magic[0] -eq 0x50 -and $magic[1] -eq 0x4B) {
        $innerDirectory = Join-Path $sourcePath "net-inner-2023-03-05"
        if (-not (Get-ChildItem -LiteralPath $innerDirectory -Filter *.nnue -Recurse -ErrorAction SilentlyContinue)) {
            $containerZip = Join-Path $sourcePath "pikafish-nnue-container.zip"
            Copy-Item -LiteralPath $networkPath -Destination $containerZip -Force
            Expand-Archive -LiteralPath $containerZip -DestinationPath $innerDirectory -Force
            Remove-Item -LiteralPath $containerZip -Force
        }
        $innerNetwork = Get-ChildItem -LiteralPath $innerDirectory -Filter *.nnue -Recurse | Select-Object -First 1
        if (-not $innerNetwork) { throw "Failed to extract raw NNUE from zip container." }
        $networkPath = $innerNetwork.FullName
    }
}

if (-not (Test-Path -LiteralPath $networkPath -PathType Leaf)) {
    throw "NNUE file not found: $networkPath"
}

$emscriptenDirectory = Join-Path $sourcePath "src\emscripten"
Copy-Item -LiteralPath $networkPath -Destination (Join-Path $emscriptenDirectory "pikafish.nnue") -Force

$dockerSource = $sourcePath.Replace("\", "/")
docker run --rm `
    --volume "${dockerSource}:/work" `
    --workdir /work/src `
    emscripten/emsdk:3.1.74 `
    emmake make clean
if ($LASTEXITCODE -ne 0) { throw "Pikafish WASM clean failed." }

docker run --rm `
    --volume "${dockerSource}:/work" `
    --workdir /work/src `
    emscripten/emsdk:3.1.74 `
    bash -lc "emmake make -j`$(nproc) build ARCH=wasm-single-simd128 COMP=emscripten"
if ($LASTEXITCODE -ne 0) { throw "Pikafish WASM build failed." }

New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
foreach ($name in @("pikafish.js", "pikafish.wasm", "pikafish.data")) {
    $builtFile = Join-Path $emscriptenDirectory $name
    if (-not (Test-Path -LiteralPath $builtFile -PathType Leaf)) {
        throw "Missing build artifact: $builtFile"
    }
    Copy-Item -LiteralPath $builtFile -Destination (Join-Path $outputPath $name) -Force
}

Write-Host "Pikafish WASM artifacts are ready: $outputPath"
Get-ChildItem -LiteralPath $outputPath -File |
    Where-Object Name -In @("pikafish.worker.js", "pikafish.js", "pikafish.wasm", "pikafish.data") |
    Select-Object Name, Length
