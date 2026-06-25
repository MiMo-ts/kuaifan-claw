@echo off

echo 注意：在Windows上构建macOS版本需要安装交叉编译工具链
 echo 请确保已安装osxcross或其他macOS交叉编译工具
 echo 详细信息请参考：https://tauri.app/v1/guides/building/cross-platform

echo.

REM 构建macOS版本（交叉编译）
cd web
npm run tauri:build -- --target aarch64-apple-darwin

REM 检查构建是否成功
if %errorlevel% neq 0 (
    echo 构建失败，请检查错误信息
    pause
    exit /b %errorlevel%
)

REM 复制构建产物到mac目录
mkdir ..\mac\bin 2>nul
xcopy /E /Y ..\src-tauri\target\aarch64-apple-darwin\release ..\mac\bin\

REM 复制启动脚本
copy ..\mac\start.sh ..\mac\bin\

REM 设置执行权限（在macOS上需要）
echo 请在macOS上运行：chmod +x start.sh

echo macOS构建完成，产物已保存到 mac 目录
pause