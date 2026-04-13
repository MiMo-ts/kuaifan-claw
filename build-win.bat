@echo off

REM 构建Windows版本
cd web
npm run tauri:build

REM 复制构建产物到win目录
mkdir ..\win\bin 2>nul
xcopy /E /Y ..\src-tauri\target\release ..\win\bin\

REM 复制启动脚本
copy ..\start.bat ..\win\

echo Windows构建完成，产物已保存到 win 目录
pause