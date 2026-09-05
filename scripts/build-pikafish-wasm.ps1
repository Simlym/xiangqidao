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

if (-not (Test-Path -LiteralPath (Join-Path $sourcePath "src\Makefile"))) {
    git clone --depth 1 --branch wasm https://github.com/ousc/Pikafish-wasm.git $sourcePath
    if ($LASTEXITCODE -ne 0) { throw "Failed to clone Pikafish WASM source." }
}

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
