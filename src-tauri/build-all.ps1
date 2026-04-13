#Requires -Version 5.1
<#
.SYNOPSIS
    快泛claw 一键构建打包（Windows）
    完整流程：下载内置资源 - 构建前端 - Rust 编译 - 打包 NSIS + MSI。

.DESCRIPTION
    完整流程：
      1. 预检 Rust / Node.js / npm 环境
      2. 清理上一次构建的产出文件（避免残留堆叠）
      3. 下载内置资源（download-bundles.ps1）
      4. 构建前端（web/dist）
      5. 运行 cargo tauri build，产出 installers/

    用法：
      .\build-all.ps1                     # 默认 release
      .\build-all.ps1 -Profile debug       # 调试构建
      .\build-all.ps1 -SkipPlugins          # 跳过通道插件下载
      .\build-all.ps1 -Force               # 强制重新下载所有内置资源

.PARAMETER Profile
    构建类型：release（默认）或 debug

.PARAMETER SkipPlugins
    跳过通道插件（wxwork/qq/wechat_clawbot）的 tgz 下载（保留已存在的）

.PARAMETER Force
    强制重新下载所有内置资源（相当于先运行 download-bundles.ps1 -Force）
#>

param(
    [ValidateSet("release", "debug")]
    [string]$Profile = "release",

    [switch]$SkipPlugins,

    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$SrcTauri = Join-Path $RepoRoot "src-tauri"
$WebDir   = Join-Path $RepoRoot "web"

function Ok($msg)   { Write-Host "[  OK  ] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 0：环境预检
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  快泛claw 构建打包  ($Profile)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

function Test-Cmd($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Fail "未找到 $name。$hint"
    }
}

Test-Cmd "rustc" "请先安装 Rust：https://rustup.rs"
Test-Cmd "cargo" "请先安装 Rust：https://rustup.rs"
Test-Cmd "node"  "请先安装 Node.js：https://nodejs.org"
Test-Cmd "npm"   "请先安装 Node.js：https://nodejs.org"

Ok "环境就绪 ($( & node --version ) / $( & rustc --version ))"

if (-not (Test-Path $WebDir)) {
    Fail "前端目录不存在：$WebDir"
}

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 1：清理上一次构建的产出文件
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[步骤] 清理上一次构建残留..." -ForegroundColor Cyan

$targetDir = Join-Path $SrcTauri "target\$Profile"

# 清理 bundle 目录（安装包产出）
$bundleDir = Join-Path $targetDir "bundle"
if (Test-Path $bundleDir) {
    Get-ChildItem $bundleDir -Recurse -File | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $bundleDir -Recurse -Directory | Where-Object { $_.FullName -ne $bundleDir } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  已清理 bundle 目录" -ForegroundColor DarkGray
}

# 清理上一次生成的 exe
$exeName = "快泛claw.exe"
$oldExe = Join-Path $targetDir $exeName
if (Test-Path $oldExe) {
    Remove-Item $oldExe -Force -ErrorAction SilentlyContinue
    Write-Host "  已清理上一次生成的 $exeName" -ForegroundColor DarkGray
}

# 清理上一次解压到 resources 的内置工具（bundled-env 解压产物），每次构建前重新解压
$bundledEnvDir = Join-Path $SrcTauri "resources\bundled-env"
if (Test-Path $bundledEnvDir) {
    Get-ChildItem $bundledEnvDir -Directory | ForEach-Object {
        $innerExe = Join-Path $_.FullName "node.exe"
        $innerGit = Join-Path $_.FullName "cmd\git.exe"
        if ((Test-Path $innerExe) -or (Test-Path $innerGit)) {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "  已清理内置工具残留: $($_.Name)" -ForegroundColor DarkGray
        }
    }
}

# 清理上一次生成的 NSIS/WiX 临时文件
$nsisOut = Join-Path $targetDir "nsis"
$wixOut = Join-Path $targetDir "wix"
@($nsisOut, $wixOut) | ForEach-Object {
    if (Test-Path $_) {
        Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  已清理 $_" -ForegroundColor DarkGray
    }
}

Ok "清理完成"

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 2：下载内置资源（统一入口）
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[步骤] 下载内置资源..." -ForegroundColor Cyan

$dlArgs = @()
if ($SkipPlugins) { $dlArgs += "-PluginsOnly" }
if ($Force)      { $dlArgs += "-Force" }

& "$SrcTauri\download-bundles.ps1" @dlArgs

if ($LASTEXITCODE -ne 0) {
    Fail "download-bundles.ps1 失败。请检查网络后重试，或跳过 npm 相关下载：\n    .\download-bundles.ps1 -PluginsOnly"
}

Write-Host ""

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 3：构建前端
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "[步骤] 构建前端..." -ForegroundColor Cyan

Push-Location $WebDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "  首次构建：安装前端依赖..." -ForegroundColor Yellow
        & npm install
        if ($LASTEXITCODE -ne 0) { Fail "npm install 失败" }
    }

    & npm run build
    if ($LASTEXITCODE -ne 0) { Fail "npm run build 失败" }
}
finally { Pop-Location }

Ok "前端构建完成 -> $WebDir\dist"

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 4：Rust / Tauri 构建
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[步骤] Rust / Tauri 构建..." -ForegroundColor Cyan

Push-Location $SrcTauri
try {
    $cargoCmd = if ($Profile -eq "release") { "cargo tauri build" } else { "cargo build" }
    Write-Host "  运行: $cargoCmd" -ForegroundColor DarkGray
    & cmd /c "$cargoCmd 2>&1"
    if ($LASTEXITCODE -ne 0) { Fail "Rust / Tauri 构建失败" }
}
finally { Pop-Location }

Ok "构建完成"

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 5：列出产出
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  构建完成！" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

$outDir = Join-Path $SrcTauri "target\$Profile\bundle"
$installers = Get-ChildItem $outDir -Include "*.exe","*.msi" -Recurse | Select-Object -First 20

if ($installers) {
    Write-Host "  安装包：" -ForegroundColor White
    foreach ($f in $installers) {
        $sizeMB = [math]::Round($f.Length / 1MB, 1)
        Write-Host "    $($f.Name)  ($sizeMB MB)" -ForegroundColor Cyan
    }
} else {
    Write-Host "  未找到安装包，检查目标目录：$outDir" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  提示: 若需重新下载内置资源（强制覆盖），运行：" -ForegroundColor Yellow
Write-Host "        .\download-bundles.ps1 -Force" -ForegroundColor Gray
Write-Host ""
