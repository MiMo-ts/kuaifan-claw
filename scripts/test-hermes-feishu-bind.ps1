param(
    [ValidateSet("Start", "Poll", "Cancel")]
    [string]$Mode = "Start",
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$registrationUrl = "https://accounts.feishu.cn/oauth/v1/app/registration"
$sessionDirectory = Join-Path $PSScriptRoot "..\.tmp\hermes-feishu-bind"
$sessionPath = Join-Path $sessionDirectory "session.json"
$qrPath = Join-Path $sessionDirectory "feishu-qr.png"
$applyHelperPath = Join-Path $PSScriptRoot "apply-hermes-feishu-test-bind.py"
$python = Join-Path $PSScriptRoot "..\src-tauri\runtimes\hermes\python\python.exe"

function Invoke-FeishuForm([hashtable]$Body) {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $registrationUrl `
        -ContentType "application/x-www-form-urlencoded" -Body $Body -TimeoutSec 30
    return $response.Content | ConvertFrom-Json
}

function Get-Value($Value, [string]$Name) {
    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return ""
    }
    return [string]$property.Value
}

function Test-HermesCredential([string]$AppId, [string]$AppSecret) {
    $tokenBody = @{ app_id = $AppId; app_secret = $AppSecret } | ConvertTo-Json -Compress
    $token = Invoke-RestMethod -Method Post `
        -Uri "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" `
        -ContentType "application/json" -Body $tokenBody -TimeoutSec 30

    $wsBody = @{ AppID = $AppId; AppSecret = $AppSecret } | ConvertTo-Json -Compress
    $endpoint = Invoke-RestMethod -Method Post -Uri "https://open.feishu.cn/callback/ws/endpoint" `
        -ContentType "application/json" -Body $wsBody -TimeoutSec 30

    [PSCustomObject]@{
        tenantTokenCode = $token.code
        websocketCode = $endpoint.code
        hasWebsocketUrl = [bool](Get-Value $endpoint.data "URL")
    }
}

if ($Mode -eq "Cancel") {
    Remove-Item -Force $sessionPath, $qrPath -ErrorAction SilentlyContinue
    Write-Output "Cancelled the Hermes Feishu test session."
    exit 0
}

if ($Mode -eq "Start") {
    New-Item -ItemType Directory -Force -Path $sessionDirectory | Out-Null
    $init = Invoke-FeishuForm @{ action = "init" }
    if (-not (@($init.supported_auth_methods) -contains "client_secret")) {
        throw "Feishu registration does not support client_secret in this environment."
    }

    $begin = Invoke-FeishuForm @{
        action = "begin"
        archetype = "PersonalAgent"
        auth_method = "client_secret"
        request_user_info = "open_id"
    }
    $deviceCode = Get-Value $begin "device_code"
    $verificationUri = Get-Value $begin "verification_uri_complete"
    if ([string]::IsNullOrWhiteSpace($verificationUri)) {
        $verificationUri = Get-Value $begin "verification_uri"
    }
    if ([string]::IsNullOrWhiteSpace($deviceCode) -or [string]::IsNullOrWhiteSpace($verificationUri)) {
        throw "Feishu registration did not return a device code and QR URL."
    }

    $separator = if ($verificationUri.Contains("?")) { "&" } else { "?" }
    $qrUrl = "$verificationUri${separator}from=hermes&tp=hermes"
    $expiresIn = 600
    if ($null -ne $begin.expires_in) {
        $expiresIn = [int]$begin.expires_in
    }
    $intervalSeconds = 5
    if ($null -ne $begin.interval) {
        $intervalSeconds = [int]$begin.interval
    }
    $session = [PSCustomObject]@{
        deviceCode = $deviceCode
        expiresAt = (Get-Date).AddSeconds($expiresIn).ToUniversalTime().ToString("o")
        intervalSeconds = $intervalSeconds
        qrUrl = $qrUrl
    }
    $session | ConvertTo-Json | Set-Content -Encoding UTF8 $sessionPath

    if (-not (Test-Path $python)) {
        throw "Hermes Python runtime is unavailable: $python"
    }
    $env:HERMES_FEISHU_QR_URL = $qrUrl
    $env:HERMES_FEISHU_QR_PATH = $qrPath
    & $python -c "import os, qrcode; qrcode.make(os.environ['HERMES_FEISHU_QR_URL']).save(os.environ['HERMES_FEISHU_QR_PATH'])"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $qrPath)) {
        throw "Unable to render the Feishu QR code."
    }

    [PSCustomObject]@{
        status = "ready_to_scan"
        expiresAt = $session.expiresAt
        qrPath = $qrPath
    } | ConvertTo-Json -Compress
    exit 0
}

if (-not (Test-Path $sessionPath)) {
    throw "No active test session. Run with -Mode Start first."
}
$session = Get-Content -Raw $sessionPath | ConvertFrom-Json
if ((Get-Date).ToUniversalTime() -ge [DateTime]::Parse($session.expiresAt).ToUniversalTime()) {
    throw "The test QR code has expired. Run with -Mode Start again."
}

$registration = Invoke-FeishuForm @{ action = "poll"; device_code = $session.deviceCode; tp = "ob_app" }
$appId = Get-Value $registration "app_id"
$appSecret = Get-Value $registration "app_secret"
if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($appSecret)) {
    $appId = Get-Value $registration "client_id"
    $appSecret = Get-Value $registration "client_secret"
}
if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($appSecret)) {
    [PSCustomObject]@{
        status = (Get-Value $registration "error")
        detail = (Get-Value $registration "error_description")
    } | ConvertTo-Json -Compress
    exit 0
}

$result = Test-HermesCredential -AppId $appId -AppSecret $appSecret
$compatible = $result.tenantTokenCode -eq 0 -and $result.websocketCode -eq 0 -and $result.hasWebsocketUrl
$applied = $false
if ($Apply -and $compatible) {
    $dataDirectory = $env:HERMES_TEST_DATA_DIR
    if ([string]::IsNullOrWhiteSpace($dataDirectory) -or -not (Test-Path $dataDirectory)) {
        throw "HERMES_TEST_DATA_DIR must point to the installed data directory when -Apply is used."
    }
    $openId = Get-Value $registration.user_info "open_id"
    $payload = @{
        data_dir = $dataDirectory
        app_id = $appId
        app_secret = $appSecret
        open_id = $openId
        local_appdata = $env:LOCALAPPDATA
    } | ConvertTo-Json -Compress
    $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $env:HERMES_TEST_BIND_PAYLOAD_BASE64 = [Convert]::ToBase64String($payloadBytes)
    try {
        & $python $applyHelperPath
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to apply the validated Feishu binding to Hermes."
        }
        $applied = $true
    }
    finally {
        Remove-Item Env:HERMES_TEST_BIND_PAYLOAD_BASE64 -ErrorAction SilentlyContinue
    }
}
Remove-Item -Force $sessionPath, $qrPath -ErrorAction SilentlyContinue
[PSCustomObject]@{
    status = if ($compatible) { "hermes_compatible" } else { "incompatible" }
    tenantTokenCode = $result.tenantTokenCode
    websocketCode = $result.websocketCode
    hasWebsocketUrl = $result.hasWebsocketUrl
    applied = $applied
} | ConvertTo-Json -Compress
