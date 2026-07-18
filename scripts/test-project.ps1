#Requires -Version 5.1

param(
    [switch]$SkipRust,
    [switch]$SkipWeb
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent

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

if (-not $SkipRust) {
    Invoke-Checked (Join-Path $RepoRoot "src-tauri") "cargo test --locked"
}

if (-not $SkipWeb) {
    Invoke-Checked (Join-Path $RepoRoot "web") "npm test"
}

Write-Host "Tests passed. Test artifacts: $RepoRoot\artifacts\test" -ForegroundColor Green
