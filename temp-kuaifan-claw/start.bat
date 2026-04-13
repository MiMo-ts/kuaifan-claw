@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "FOUND_EXE="
set "EXE_MSG="

:: 1. 当前目录（标准发行布局）
if exist "openclaw-cn-manager.exe" (
    set "FOUND_EXE=%~dp0openclaw-cn-manager.exe"
    set "EXE_MSG=found in current directory (packaged release)"
    goto :launch
)

:: 2. src-tauri\target\release
if exist "src-tauri\target\release\openclaw-cn-manager.exe" (
    set "FOUND_EXE=%~dp0src-tauri\target\release\openclaw-cn-manager.exe"
    set "EXE_MSG=found in src-tauri\target\release (release build)"
    goto :launch
)

:: 3. src-tauri\target\debug
if exist "src-tauri\target\debug\openclaw-cn-manager.exe" (
    set "FOUND_EXE=%~dp0src-tauri\target\debug\openclaw-cn-manager.exe"
    set "EXE_MSG=found in src-tauri\target\debug (dev build)"
    goto :launch
)

:: 未找到
echo.
echo [Hint] openclaw-cn-manager.exe not found.
echo.
echo Searched locations:
echo   1. Current directory   - openclaw-cn-manager.exe
echo   2. src-tauri\target\release\openclaw-cn-manager.exe
echo   3. src-tauri\target\debug\openclaw-cn-manager.exe
echo.
echo This script is for launching a packaged release.
echo For development:
echo   - Double-click dev.bat  (recommended)
echo   - Or run:  dev.bat
echo   - Or run:  cd web ^&^& npm run tauri:dev
echo.
echo To build the exe:
echo   - cd src-tauri ^&^& cargo build --release
echo   - Or run:  cd web ^&^& npm run tauri:build
echo.
pause
exit /b 1

:launch
echo [start.bat] Starting OpenClaw-CN Manager...
echo        %EXE_MSG%
echo.
start "" "%FOUND_EXE%"
