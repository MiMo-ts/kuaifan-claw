#Requires -Version 5.1
<#
.SYNOPSIS
    下载 OpenClaw-CN Manager 所有内置资源（离线包）。
    必须在 `cargo tauri build` 之前运行一次。
    成功下载的文件不会重复下载（幂等）。

.DESCRIPTION
    下载内容：
      bundled-env/node-v22.14.0-win-x64.zip       Node.js 离线包
      bundled-env/MinGit-2.53.0-64-bit.zip        MinGit 离线包
      bundled-openclaw/openclaw-cn.tgz             openclaw-cn npm 包（npm pack）
      resources/plugins/wxwork.tgz                企业微信插件
      resources/plugins/qq.tgz                    QQ 插件
      resources/plugins/wechat_clawbot.tgz        微信插件

    策略：
      - HTTP 文件（Node.js / MinGit）：国内 npmmirror 优先，失败自动回退官方源
      - npm 包（openclaw-cn / 通道插件）：npm pack 优先 npmmirror，回退 registry.npmjs.org
      - 幂等：已存在且大小正常的文件跳过，不重复下载
      - 所有下载失败都会终止脚本并打印明确错误，不静默跳过

.PARAMETER Force
    强制重新下载，即使文件已存在。

.PARAMETER PluginsOnly
    仅下载通道插件 tgz，跳过 Node.js / MinGit / openclaw-cn。

.EXAMPLE
    # 下载全部（首次运行必选）
    .\download-bundles.ps1

    # 强制重新下载
    .\download-bundles.ps1 -Force

    # 仅下载通道插件（Node.js/MinGit/openclaw-cn 已存在时加速）
    .\download-bundles.ps1 -PluginsOnly

    # 在 CI 中使用代理
    $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
    .\download-bundles.ps1
#>

param(
    [switch]$Force,
    [switch]$PluginsOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$SrcTauri = Join-Path $RepoRoot "src-tauri"

# ═══════════════════════════════════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════════════════════════════════

function Step($msg) {
    Write-Host ""
    Write-Host "[下载] $msg" -ForegroundColor Cyan
}

function Ok($msg) {
    Write-Host "[  OK  ] $msg" -ForegroundColor Green
}

function Skip($msg) {
    Write-Host "[跳过] $msg" -ForegroundColor DarkGray
}

function Fail($msg) {
    Write-Host ""
    Write-Host "[错误] $msg" -ForegroundColor Red
    exit 1
}

function Info($msg) {
    Write-Host "        $msg" -ForegroundColor DarkGray
}

function Ensure-Dir($path) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

function File-Sufficient($path, $minBytes) {
    (Test-Path $path) -and ((Get-Item $path).Length -ge $minBytes)
}

function Format-Size($bytes) {
    if ($bytes -ge 1MB) {
        return "{0:N1} MB" -f ($bytes / 1MB)
    } else {
        return "{0:N0} KB" -f ($bytes / 1KB)
    }
}

# ───────────────────────────────────────────────────────────────────────────
# Download-File($url, $dest, $label, $minBytes)
#   用 .NET WebClient 下载，支持多源回退
# ───────────────────────────────────────────────────────────────────────────
function Download-File($url, $dest, $label, $minBytes) {
    if ((-not $Force) -and (File-Sufficient $dest $minBytes)) {
        $size = Format-Size (Get-Item $dest).Length
        Skip "$label 已就绪 ($size)"
        return
    }
    Ensure-Dir $dest

    # 计算备用 URL 列表（处理 npmmirror / nodejs.org / github 等不同域名的替换规则）
    $fallbacks = @($url)
    if ($url -match 'npmmirror\.com') {
        # npmmirror 域名替换 → registry.npmmirror.com
        $fallbacks += $url -replace 'npmmirror\.com/mirrors/', 'registry.npmmirror.com/-/'
        $fallbacks += $url -replace 'npmmirror\.com', 'npmjs.org'
    } elseif ($url -match 'registry\.npmmirror\.com') {
        # npmmirror registry → npmjs.org
        $fallbacks += $url -replace 'registry\.npmmirror\.com', 'registry.npmjs.org'
    } elseif ($url -match 'nodejs\.org') {
        # nodejs.org 官方源 → npmmirror
        $fallbacks += $url -replace 'nodejs\.org/dist', 'npmmirror.com/mirrors/node'
    } elseif ($url -match 'github\.com') {
        # GitHub 官方源备用为 npmmirror（如果路径匹配）
        if ($url -match 'git-for-windows') {
            $fallbacks += $url -replace 'github\.com/git-for-windows/git/releases/download',
                                      'npmmirror.com/mirrors/git-for-windows/releases/download'
        }
    }

    foreach ($srcUrl in $fallbacks) {
        Info "尝试: $srcUrl"
        try {
            # .NET WebClient：自动跟随重定向，Timeout=600s
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($srcUrl, $dest)

            if (File-Sufficient $dest $minBytes) {
                $size = Format-Size (Get-Item $dest).Length
                Ok "$label 下载完成 ($size)"
                return
            }

            Info "$label 文件过小，尝试下一个源"
            Remove-Item $dest -Force -EA SilentlyContinue
        } catch {
            Info "下载失败: $($_.Exception.Message)"
        }
    }

    Fail "$label 下载失败（所有源均不可达，请检查网络）"
}

# ───────────────────────────────────────────────────────────────────────────
# Npm-Pack($pkg, $dest, $label, $minBytes)
#   用 npm pack 下载 npm 包到 dest，支持多 registry 回退
# ───────────────────────────────────────────────────────────────────────────
function Npm-Pack($pkg, $dest, $label, $minBytes) {
    if ((-not $Force) -and (File-Sufficient $dest $minBytes)) {
        $size = Format-Size (Get-Item $dest).Length
        Skip "$label 已就绪 ($size)"
        return
    }
    Ensure-Dir $dest

    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "openclaw-pack-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    $registries = @(
        "https://registry.npmmirror.com",
        "https://registry.npmjs.org"
    )
    $done = $false

    foreach ($reg in $registries) {
        $env:npm_config_registry = $reg
        try {
            Info "npm pack $pkg @ $reg"
            $proc = Start-Process -FilePath npm `
                -ArgumentList "pack","$pkg","--pack-destination",$tmpDir `
                -NoNewWindow -PassThru -Wait
            Remove-Item Env:\npm_config_registry -EA SilentlyContinue

            if ($proc.ExitCode -ne 0) {
                Info "npm pack 退出码 $($proc.ExitCode)，尝试下一个 registry"
                continue
            }

            $tgz = Get-ChildItem $tmpDir -Filter "*.tgz" | Select-Object -First 1
            if (-not $tgz) {
                Info "npm pack 未产出 .tgz，尝试下一个 registry"
                continue
            }

            if ($tgz.Length -lt $minBytes) {
                Info "tgz 过小 ($(Format-Size $tgz.Length))，尝试下一个 registry"
                $tgz | Remove-Item -Force -EA SilentlyContinue
                continue
            }

            Move-Item $tgz.FullName $dest -Force
            $size = Format-Size (Get-Item $dest).Length
            Ok "$label 下载完成 ($size) ← $reg"
            $done = $true
            break
        } catch {
            Remove-Item Env:\npm_config_registry -EA SilentlyContinue
            Info "npm pack 异常: $($_.Exception.Message)"
        }
    }

    Remove-Item $tmpDir -Recurse -Force -EA SilentlyContinue

    if (-not $done) {
        Fail "$label 下载失败（所有 npm registry 均不可达）"
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  OpenClaw-CN Manager — 下载内置资源" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  目标目录: $SrcTauri" -ForegroundColor DarkGray
Write-Host "  强制模式: $Force" -ForegroundColor DarkGray
Write-Host "  仅插件:   $PluginsOnly" -ForegroundColor DarkGray
Write-Host ""

# ── 0. 环境预检 ────────────────────────────────────────────────────────────
Step "环境预检"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "[警告] 未找到 npm，将跳过 npm 包下载（openclaw-cn 和通道插件）" -ForegroundColor Yellow
    Write-Host "        请安装 Node.js（建议 v18+）：https://nodejs.org" -ForegroundColor Yellow
    $hasNpm = $false
} else {
    $nodeVer = & node --version 2>$null
    $npmVer  = & npm  --version 2>$null
    Info "Node.js $nodeVer / npm $npmVer"
    $hasNpm = $true
}

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 A：内置环境包（Node.js / MinGit / openclaw-cn）
# ═══════════════════════════════════════════════════════════════════════════
if (-not $PluginsOnly) {
    Step "下载内置环境包"

    # ── A1. Node.js ───────────────────────────────────────────────────────
    $nodeDest = Join-Path $SrcTauri "bundled-env\node-v22.14.0-win-x64.zip"
    $nodeUrl  = "https://npmmirror.com/mirrors/node/v22.14.0/node-v22.14.0-win-x64.zip"
    Download-File $nodeUrl $nodeDest "Node.js v22.14.0" (5MB)

    # ── A2. MinGit ────────────────────────────────────────────────────────
    $gitDest = Join-Path $SrcTauri "bundled-env\MinGit-2.53.0-64-bit.zip"
    $gitUrl  = "https://npmmirror.com/mirrors/git-for-windows/v2.53.0.windows.1/MinGit-2.53.0-64-bit.zip"
    Download-File $gitUrl $gitDest "MinGit 2.53.0" (400KB)

    # ── A3. openclaw-cn ────────────────────────────────────────────────────
    Step "下载 openclaw-cn npm 包（npm pack，可能需要 1~5 分钟）"
    if (-not $hasNpm) {
        Write-Host ""
        Write-Host "[错误] npm 不可用，无法下载 openclaw-cn。" -ForegroundColor Red
        Write-Host "        请安装 Node.js 后重新运行本脚本。" -ForegroundColor Yellow
        Fail "npm 不可用"
    }
    $ocDest = Join-Path $SrcTauri "bundled-openclaw\openclaw-cn.tgz"
    Npm-Pack "openclaw-cn" $ocDest "openclaw-cn" (1MB)
}

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 B：通道插件 tgz
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Step "下载通道插件 tgz"

if (-not $hasNpm) {
    Skip "npm 不可用，跳过通道插件下载（离线安装将不可用）"
} else {
    $channelPlugins = @(
        @{ Id="wxwork";         Pkg="@wecom/wecom-openclaw-plugin";      MinKB=10  },
        @{ Id="qq";             Pkg="@sliverp/qqbot";                    MinKB=10  },
        @{ Id="wechat_clawbot"; Pkg="@tencent-weixin/openclaw-weixin";  MinKB=100 },
        @{ Id="telegram";       Pkg="@clawdbot/telegram";                MinKB=10  }
    )

    foreach ($p in $channelPlugins) {
        $dest = Join-Path $SrcTauri "resources\plugins\$($p.Id).tgz"
        Npm-Pack $p.Pkg $dest "插件 $($p.Id)" ($p.MinKB * 1024)
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# 阶段 C：写入 .resource_version
# ═══════════════════════════════════════════════════════════════════════════
Step "更新 .resource_version"
$cargoToml = Join-Path $SrcTauri "Cargo.toml"
$verFile   = Join-Path $SrcTauri "resources\data\.resource_version"

if (Test-Path $cargoToml) {
    # 从 Cargo.toml 提取 version = "x.y.z"
    $versionLine = Select-String $cargoToml '^\s*version\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($versionLine) {
        $version = $versionLine.Matches.Groups[1].Value
        $currentContent = if (Test-Path $verFile) { (Get-Content $verFile -Raw).Trim() } else { "" }
        if ($currentContent -ne $version) {
            $version | Set-Content $verFile -NoNewline
            Ok ".resource_version 已更新为 v$version"
        } else {
            Skip ".resource_version 已是最新 (v$version)"
        }
    } else {
        Info "无法从 Cargo.toml 提取 version，跳过 .resource_version"
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# 完成报告
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  下载完成！" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  下一步 — 运行构建：" -ForegroundColor White
Write-Host ""
Write-Host "    正式打包（release）：" -ForegroundColor White
Write-Host "      cd $SrcTauri" -ForegroundColor Gray
Write-Host "      cargo tauri build" -ForegroundColor Gray
Write-Host ""
Write-Host "    开发调试（debug）：" -ForegroundColor White
Write-Host "      cd $SrcTauri" -ForegroundColor Gray
Write-Host "      cargo build" -ForegroundColor Gray
Write-Host ""
Write-Host "  重新下载（覆盖已有文件）：" -ForegroundColor White
Write-Host "      .\download-bundles.ps1 -Force" -ForegroundColor Gray
Write-Host ""
