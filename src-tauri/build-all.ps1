#Requires -Version 5.1

param(
    [ValidateSet("release", "debug")]
    [string]$Profile = "release",
    [switch]$SkipPlugins,
    [switch]$Force,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$SrcTauri = Join-Path $RepoRoot "src-tauri"
$WebDir = Join-Path $RepoRoot "web"

function Fail([string]$Message) {
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    exit 1
}

function Ok([string]$Message) {
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Invoke-Checked([string]$WorkingDirectory, [string]$CommandLine) {
    Push-Location $WorkingDirectory
    try {
        & cmd /c $CommandLine
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed ($LASTEXITCODE): $CommandLine"
        }
    }
    finally {
        Pop-Location
    }
}

foreach ($command in @("cargo", "node", "npm")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Fail "Required command is unavailable: $command"
    }
}

if (-not (Test-Path $WebDir)) {
    Fail "Frontend directory is unavailable: $WebDir"
}

$downloadArguments = @()
if ($SkipPlugins) { $downloadArguments += "-SkipPlugins" }
if ($Force) { $downloadArguments += "-Force" }
& (Join-Path $SrcTauri "download-bundles.ps1") @downloadArguments
if ($LASTEXITCODE -ne 0) {
    Fail "Bundled resource preparation failed"
}

if (-not $SkipTests) {
    & (Join-Path $RepoRoot "scripts\test-project.ps1")
    if ($LASTEXITCODE -ne 0) {
        Fail "Tests failed; build was not started"
    }
    Ok "Test suite passed"
}

$targetDir = Join-Path $SrcTauri "target\$Profile"
$bundleDir = Join-Path $targetDir "bundle"
if (Test-Path $bundleDir) {
    Remove-Item $bundleDir -Recurse -Force
}

if (-not (Test-Path (Join-Path $WebDir "node_modules"))) {
    Invoke-Checked $WebDir "npm ci"
}
Invoke-Checked $WebDir "npm run build"
Ok "Frontend build completed"

if ($Profile -eq "release") {
    Invoke-Checked $SrcTauri "cargo tauri build"
}
else {
    Invoke-Checked $SrcTauri "cargo build"
}
Ok "Rust build completed"

if ($Profile -eq "debug") {
    Ok "Debug output: $targetDir"
    exit 0
}

$installerRoot = Join-Path $targetDir "bundle"
$installers = @(Get-ChildItem $installerRoot -Include "*.exe", "*.msi" -Recurse -File)
if ($installers.Count -eq 0) {
    Fail "No installer was produced under $installerRoot"
}

$tauriConfigPath = Join-Path $SrcTauri "tauri.conf.json"
$versionLine = Select-String -Path $tauriConfigPath -Pattern '"version"\s*:\s*"([^"]+)"' | Select-Object -First 1
if (-not $versionLine) {
    Fail "Unable to read release version from $tauriConfigPath"
}
$releaseVersion = $versionLine.Matches.Groups[1].Value
$releaseDir = Join-Path $RepoRoot ("artifacts\release\" + $releaseVersion)
if (Test-Path $releaseDir) {
    Remove-Item $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$manifest = foreach ($installer in $installers) {
    $destination = Join-Path $releaseDir $installer.Name
    Copy-Item $installer.FullName $destination -Force
    $hash = Get-FileHash $destination -Algorithm SHA256
    [pscustomobject]@{
        file = $installer.Name
        bytes = $installer.Length
        sha256 = $hash.Hash
    }
}
$manifest | ConvertTo-Json | Set-Content (Join-Path $releaseDir "manifest.json") -Encoding UTF8
Ok "Release artifacts: $releaseDir"
