#Requires -Version 5.1

<#
.SYNOPSIS
  OpenClaw 冷启动回归脚本：清场 → 启动网关 → 校验 allowedOrigins / 飞书链路 / 控制台连接。
.DESCRIPTION
  约束：
    - 仅验证 OpenClaw 模块，不动 Hermes / openclaw-cn。
    - 优先使用 node 解析 openclaw.json（避免 PowerShell ConvertFrom-Json 在大文件上失败）。
    - 校验 gateway.controlUi.allowedOrigins 是否包含 Tauri / loopback / 端口 origin。
    - 抓取最新网关日志，统计 origin not allowed / reply session initialization conflicted。
#>

param(
    [string]$DataDir = 'D:\kuaifanclaw\src-tauri\target\debug\data',
    [string]$Exe = '',
    [int]$WaitSeconds = 90,
    [string]$ReportPath = 'D:\kuaifanclaw\artifacts\test\openclaw-cold-start.txt'
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'D:\node\node.exe' }

if (-not $Exe) {
    $exeName = (Get-ChildItem -Path (Join-Path $DataDir '..') -Filter '*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).Name
    if (-not $exeName) { $exeName = '快泛claw.exe' }
    $Exe = Join-Path (Join-Path $DataDir '..') $exeName
}

function Write-Report([string]$Message) {
    $stamp = (Get-Date).ToString('HH:mm:ss')
    $line = "[$stamp] $Message"
    Write-Host $line
    Add-Content -Path $ReportPath -Value $line -Encoding utf8
}

function Get-OpenClawCli {
    $cli = Join-Path $DataDir 'openclaw\openclaw.mjs'
    if (Test-Path $cli) { return $cli }
    throw "OpenClaw CLI not found: $cli"
}

function Read-OpenClawConfigOrigins {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return @() }
    $js = "const fs=require('fs');const p=process.argv[1];try{const j=JSON.parse(fs.readFileSync(p,'utf8'));const cu=(j.gateway&&j.gateway.controlUi)||{};const list=Array.isArray(cu.allowedOrigins)?cu.allowedOrigins:[];process.stdout.write(JSON.stringify(list));}catch(e){process.stderr.write('PARSE_ERROR:'+e.message);process.exit(1);}"
    $out = & $node -e $js $Path 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    try { return ,(($out | Out-String).Trim() | ConvertFrom-Json) } catch { return @() }
}

if (Test-Path $ReportPath) { Remove-Item $ReportPath -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null
Write-Report '== openclaw cold start regression =='
Write-Report "DataDir: $DataDir"
Write-Report "Exe: $Exe"
Write-Report "Node: $node"

# 1. Stop any lingering claw / node / openclaw processes
Get-Process 快泛claw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
        $_.CommandLine -match 'openclaw.mjs' -or
        $_.CommandLine -match '快泛claw.exe' -or
        $_.CommandLine -match 'OPENCLAW_STATE_DIR'
    )
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
}
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Seconds 2
Write-Report 'Pre-flight cleanup complete'

# 2. Inspect config before starting gateway
$cfgPath = Join-Path $DataDir 'openclaw\openclaw.json'
Write-Report "Config path: $cfgPath"

# 3. Inspect plugins list (must show feishu enabled)
$cli = Get-OpenClawCli
$env:OPENCLAW_STATE_DIR = $DataDir
$env:OPENCLAW_CONFIG_PATH = $cfgPath
$listOut = & $node $cli plugins list 2>&1
$listText = ($listOut | Out-String)
$feishuEnabled = $listText -match 'feishu.*enabled'
Write-Report "plugins list -> feishu enabled=$feishuEnabled"

# 4b. Trigger ensure_control_ui_origins_only via the new CLI flag.
#     This populates gateway.controlUi.allowedOrigins in openclaw.json without
#     requiring the Tauri main window to start.
$syncOut = & $Exe --ensure-control-ui-origins $DataDir 2>&1
$syncExit = $LASTEXITCODE
Write-Report "ensure-control-ui-origins exit=$syncExit"
$syncOut | ForEach-Object { Write-Report "  | $_" }
# 4. Validate gateway.controlUi.allowedOrigins
$origins = Read-OpenClawConfigOrigins -Path $cfgPath
$tauriOk = $false; $schemeOk = $false; $loopbackOk = $false; $lanOk = $false
if ($origins) {
    $tauriOk = $origins -contains 'http://tauri.localhost'
    $schemeOk = $origins -contains 'tauri://localhost'
    $loopbackOk = $origins -contains 'http://127.0.0.1:18789'
    $lanOk = $origins -contains 'http://localhost:18789'
}
$originCount = if ($origins) { $origins.Count } else { 0 }
Write-Report "allowedOrigins tauri=$tauriOk scheme=$schemeOk loopback12700=$loopbackOk loopbackLocalhost=$lanOk count=$originCount"

# 5. Start the gateway directly to capture stable logs (no UI required)
$logFile = Join-Path $DataDir 'logs\openclaw-gateway.log'
    try { if (Test-Path $logFile) { Remove-Item $logFile -Force } } catch {}
$proc = Start-Process -FilePath $node -ArgumentList @('openclaw.mjs','gateway','run','--bind','loopback','--port','18789') -WorkingDirectory (Join-Path $DataDir 'openclaw') -WindowStyle Hidden -PassThru
Write-Report "Gateway PID=$($proc.Id)"
$started = $false; $feishuMonitor = $false; $noPlugin = $false; $conflict = $false
$originNotAllowedCount = 0; $tauriConnCount = 0
try {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        $listener = Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue
        if ($listener) { $started = $true; break }
    }
    Write-Report "Gateway listener started=$started"
    if ($started) {
        Start-Sleep -Seconds 5
        $tail = Get-Content $logFile -Tail 200 -ErrorAction SilentlyContinue
        foreach ($line in $tail) {
            if ($line -match 'feishu\[' -and $line -match 'starting') { $feishuMonitor = $true }
            if ($line -match 'plugin not installed: feishu') { $noPlugin = $true }
            if ($line -match 'reply session initialization conflicted') { $conflict = $true }
            if ($line -match 'origin not allowed') { $originNotAllowedCount++ }
            if ($line -match 'tauri\.localhost') { $tauriConnCount++ }
        }
        Write-Report "feishu monitor started=$feishuMonitor plugin-not-installed=$noPlugin reply-conflict=$conflict"
        Write-Report "log origin-not-allowed count=$originNotAllowedCount tauri-conn count=$tauriConnCount"
    }

    # 6. Verify main session JSONL still exists
    $mainSession = Join-Path $DataDir 'openclaw\agents\main\sessions\sessions.json'
    if (Test-Path $mainSession) {
        $sessionCount = (Get-Content $mainSession -Raw | ConvertFrom-Json).PSObject.Properties.Count
        Write-Report "main session entries=$sessionCount"
    } else {
        Write-Report 'main session file MISSING'
    }

    # 7. Hit the gateway with the Tauri origin to verify controlUi acceptance
    try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:18789/' -Headers @{'Origin'='http://tauri.localhost'} -UseBasicParsing -TimeoutSec 5
        Write-Report "control UI tauri origin -> status $($resp.StatusCode)"
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match '426|Upgrade Required') {
            Write-Report 'control UI tauri origin -> 426 Upgrade Required (origin accepted)'
        } else {
            Write-Report "control UI tauri origin -> ERROR $msg"
        }
    }

    # 8. Re-read config to verify allowedOrigins survived the gateway startup
    $originsAfter = Read-OpenClawConfigOrigins -Path $cfgPath
    if ($originsAfter) {
        $tauriAfter = $originsAfter -contains 'http://tauri.localhost'
        Write-Report "after-startup allowedOrigins tauri=$tauriAfter count=$($originsAfter.Count)"
    }
} finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}

Write-Report '== done =='
Write-Host "Report saved to $ReportPath"