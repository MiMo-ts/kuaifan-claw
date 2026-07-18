@echo off
setlocal

REM Release build: tests -> package -> artifacts\release\<version>
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0src-tauri\build-all.ps1"
if errorlevel 1 exit /b %errorlevel%

echo Windows release completed. See artifacts\release.
endlocal
