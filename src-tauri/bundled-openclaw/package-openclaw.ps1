#Requires -Version 5.1
<#
.SYNOPSIS
    Pre-build openclaw-cn npm tarball, output openclaw-cn.tgz to this directory.
    Execute once before building the installer, the output is placed in bundled-openclaw/openclaw-cn.tgz,
    for tauri bundle to package into the installer,实现 "unzip and use" offline installation.

.DESCRIPTION
    Dependencies: Node.js (any version, node + npm in PATH), pnpm (optional, if exists, priority).
    Default to use domestic npmmirror (faster), automatically fallback to registry.npmjs.org if failed.
    Process:
      1. Priority npmmirror (domestic fast); fallback registry.npmjs.org
      2. npm pack openclaw-cn@latest (or specified version) in temporary directory
      3. Verify product size (should be > 1MB) to avoid pulling empty package
      4. Move the output .tgz to openclaw-cn.tgz in this directory
      5. Clean up temporary directory

.PARAMETER Version
    Specify openclaw-cn version/tag (default is latest).

.PARAMETER Registry
    Specify npm registry (default is domestic npmmirror, fallback to npmjs.org).

.PARAMETER OutputFile
    Output file name (default is ./openclaw-cn.tgz).

.EXAMPLE
    # Use default configuration (domestic mirror, fallback to npmjs.org)
    .\package-openclaw.ps1

    # Specify version
    .\package-openclaw.ps1 -Version "1.2.3"

    # Specify custom registry
    .\package-openclaw.ps1 -Registry "https://registry.npmmirror.com"
#>

param(
    [string]$Version    = "latest",
    [string]$Registry    = "https://registry.npmmirror.com",
    [string]$OutputFile  = "$PSScriptRoot/openclaw-cn.tgz"
)

$ErrorActionPreference = "Stop"

# Domestic mirror priority, fallback list
$RegistryFallbacks = @(
    $Registry,
    "https://registry.npmjs.org"
)

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "openclaw-pack-$(Get-Random)"
$selectedRegistry = $null
$packSucceeded = $false

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  openclaw-cn packaging script  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Version       : $Version"
Write-Host "Main Registry: $Registry"
Write-Host "Fallback list   : $($RegistryFallbacks -join ' -> ' )"
Write-Host "Output file   : $OutputFile"
Write-Host "Temporary directory   : $tmpDir"
Write-Host ""

# Step 0: Check Node.js + npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[Error] npm not found, please install Node.js first (recommended v18+)" -ForegroundColor Red
    Write-Host "Tip: Download from https://nodejs.org or use winget install OpenJS.NodeJS" -ForegroundColor Yellow
    exit 1
}

$nodeVersion = & node --version 2>$null
$npmVersion  = & npm  --version 2>$null
Write-Host "[Node.js] v$nodeVersion" -ForegroundColor Green
Write-Host "[npm]     v$npmVersion" -ForegroundColor Green

# Step 1: Clean up old output
if (Test-Path $OutputFile) {
    $oldSize = (Get-Item $OutputFile).Length
    Write-Host "[Cleanup] Remove old output $OutputFile ($([math]::Round($oldSize/1MB,2)) MB)" -ForegroundColor Yellow
    Remove-Item $OutputFile -Force
}

# Step 2: Create temporary directory
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {
    # Step 3: Try each registry in turn
    foreach ($reg in $RegistryFallbacks) {
        $selectedRegistry = $reg
        Write-Host ""
        Write-Host "[Try] Registry: $reg" -ForegroundColor Cyan

        $env:npm_config_registry = $reg
        $env:NPM_CONFIG_REGISTRY = $reg

        try {
            $pkgSpec = if ($Version -eq "latest") { "openclaw-cn" } else { "openclaw-cn@$Version" }
            Write-Host "       Run: npm pack $pkgSpec --pack-destination $tmpDir" -ForegroundColor Gray

            $stdoutFile = Join-Path $tmpDir "npm-stdout.log"
            $stderrFile = Join-Path $tmpDir "npm-stderr.log"

            $proc = Start-Process -FilePath npm `
                -ArgumentList "pack","$pkgSpec","--pack-destination",$tmpDir `
                -NoNewWindow -PassThru `
                -RedirectStandardOutput $stdoutFile `
                -RedirectStandardError $stderrFile `
                -Wait

            if ($proc.ExitCode -ne 0) {
                if (Test-Path $stderrFile) {
                    $stderr = Get-Content $stderrFile -Raw
                } else {
                    $stderr = ""
                }
                Write-Host "[Failed] npm pack exit code $($proc.ExitCode)" -ForegroundColor Red
                if ($stderr) {
                    Write-Host "       $stderr" -ForegroundColor DarkRed
                }
                # Clean up current round residues
                Get-ChildItem $tmpDir -Filter "*.tgz" | Remove-Item -Force -EA SilentlyContinue
                continue  # Try next registry
            }

            # Step 4: Verify output
            $tgz = Get-ChildItem -Path $tmpDir -Filter "*.tgz" | Select-Object -First 1
            if (-not $tgz) {
                Write-Host "[Failed] npm pack did not produce .tgz file" -ForegroundColor Red
                continue  # Try next registry
            }

            $sizeMB = [math]::Round($tgz.Length / 1MB, 2)
            Write-Host "[Output] $($tgz.FullName)" -ForegroundColor Green
            Write-Host "[Size] $sizeMB MB" -ForegroundColor Green

            # npm pulling empty package or very small file (< 500KB) is usually network truncation or permission issue
            if ($tgz.Length -lt 500KB) {
                Write-Host "[Warning] tgz file too small ($sizeMB MB), may be incomplete, will retry next registry" -ForegroundColor Yellow
                $tgz | Remove-Item -Force -EA SilentlyContinue
                continue
            }

            Write-Host "[Complete] Successfully pulled openclaw-cn@$Version from registry $reg" -ForegroundColor Green

            # Step 5: Move to target location
            Move-Item -Path $tgz.FullName -Destination $OutputFile -Force
            $finalSize = [math]::Round((Get-Item $OutputFile).Length / 1MB, 2)
            
            # Step 6: Encrypt output
            $encryptScript = "$PSScriptRoot\..\scripts\encrypt-package.js"
            if (Test-Path $encryptScript) {
                Write-Host "[Encrypt] Encrypting output..." -ForegroundColor Cyan
                $key = "OpenClaw-CN-Encryption-Key"  # Should get from environment variable or config file in actual use
                try {
                    & node $encryptScript $OutputFile $key
                    Write-Host "[Success] Output encrypted successfully" -ForegroundColor Green
                } catch {
                    Write-Host "[Warning] Encryption failed, will use unencrypted output" -ForegroundColor Yellow
                    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor DarkYellow
                }
            } else {
                Write-Host "[Warning] Encryption script not found, will use unencrypted output" -ForegroundColor Yellow
            }
            
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "  Packaging completed!" -ForegroundColor Green
            Write-Host "  Output: $OutputFile" -ForegroundColor Green
            Write-Host "  Size: $finalSize MB" -ForegroundColor Green
            Write-Host "  Source: $reg" -ForegroundColor Green
            Write-Host "  Version: $Version" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green
            $packSucceeded = $true
            break  # Success, exit registry loop

        }
        finally {
            Remove-Item Env:\npm_config_registry -ErrorAction SilentlyContinue
            Remove-Item Env:\NPM_CONFIG_REGISTRY -ErrorAction SilentlyContinue
        }
    }

    if (-not $packSucceeded) {
        Write-Host ""
        Write-Host "[Error] All registries failed, please check network or manually specify registry:" -ForegroundColor Red
        Write-Host "  .\package-openclaw.ps1 -Registry 'https://registry.npmjs.org'" -ForegroundColor Yellow
        Write-Host "  Or use proxy to access npmjs.org after installing Node.js" -ForegroundColor Yellow
        exit 1
    }
}
finally {
    # Step 6: Clean up temporary directory
    if (Test-Path $tmpDir) {
        Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
