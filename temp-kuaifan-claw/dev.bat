@echo off
chcp 65001 >nul

REM ============================================================
REM OpenClaw-CN Manager - Development startup script
REM ============================================================
REM How it works:
REM   npm run tauri:dev runs:
REM     cd ..\src-tauri && node ..\web\node_modules\@tauri-apps\cli\tauri.js dev
REM   - cd switches to src-tauri/ (npm script changes cwd via cd)
REM   - node runs tauri.js directly (avoids npx PATH lookup)
REM   - beforeDevCommand: npm --prefix ../web run dev（相对 src-tauri）
REM   - npm tauri:dev 会传 --no-default-features，关闭 Cargo 默认的 tauri/custom-protocol，
REM     这样开发态走 devUrl（127.0.0.1:5173）连 Vite；直接 cargo build --release 则带默认 feature，走内置资源。
REM ============================================================

REM ---- Stop previous debug exe (otherwise Cargo: failed to remove ... os error 5) ----
echo [dev.bat] Stopping any running openclaw-cn-manager.exe (tray / background)...
taskkill /F /IM openclaw-cn-manager.exe >nul 2>&1

REM ---- Handle Vite port 5173 conflict ---------------------------------
for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    echo [dev.bat] Port 5173 occupied by PID %%A, terminating...
    taskkill /F /PID %%A >nul 2>&1
)

REM ---- Change to web directory ----------------------------------------
cd /d "%~dp0web"
if errorlevel 1 (
    echo [dev.bat] Cannot enter web directory: %~dp0web
    pause
    exit /b 1
)

REM ---- Install dependencies if needed ----------------------------------
if not exist "node_modules" (
    echo [dev.bat] node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo [dev.bat] npm install failed.
        pause
        exit /b 1
    )
)

REM ---- Launch Tauri dev server ----------------------------------------
echo [dev.bat] Current directory: %CD%
echo [dev.bat] Starting Tauri dev...
echo.
call npm run tauri:dev
if errorlevel 1 (
    echo.
    echo [dev.bat] Tauri dev exited with error. Check the output above.
    pause
    exit /b 1
)