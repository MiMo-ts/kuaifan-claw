@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo  Skill 环境离线安装脚本
echo  从预编译包恢复 skill Python 环境
echo ========================================
echo.

set "PROJECT_DIR=%~dp0.."
set "ENV_DIR=%PROJECT_DIR%\scripts\data\skills-env"

REM 与 build-skills-env.bat 中 SKILL_IDS 一致；用 web_search 标记判断包是否解压完整
echo [检查] 查找预编译环境...
if not exist "%ENV_DIR%\web_search\setup.done" (
    echo.
    echo [错误] 未找到预编译环境（缺少 web_search\setup.done 标记）
    echo.
    echo 请选择以下方式之一:
    echo.
    echo   方式 1: 在本机运行 build-skills-env.bat 联网构建
    echo.
    echo   方式 2: 解压 skills-env-offline.zip
    echo           将 zip 内 skills-env 文件夹内容放到:
    echo           %ENV_DIR%\
    echo           （即每个 skill 子目录下应有 .venv 与 setup.done）
    echo.
    echo   方式 3: 手动复制整个 scripts\data\skills-env\ 目录
    echo.
    pause
    exit /b 1
)
echo   预编译环境已就绪
echo.

echo 可用的 skill 环境 (Python 预编译):
echo.
echo   1. tushare            A股数据（需 TUSHARE_TOKEN）
echo   2. stock_news         股票新闻分析
echo   3. quant_algo         量化相关依赖
echo   4. web_search         网页搜索（纯 stdlib venv）
echo   5. xiaohongshu_copy   小红书辅助（requests）
echo   6. document_parser    文档解析（与总仓 requirements 对齐）
echo   7. excel_analyzer     Excel/表格（pandas+openpyxl）
echo   8. data_analysis      数据分析（pandas+numpy）
echo   9. 全部上述环境
echo   10. 检查已安装的环境状态
echo   0. 退出
echo.

set /p CHOICE="请选择 (0-10): "

if "%CHOICE%"=="0" goto :end
if "%CHOICE%"=="10" goto :check_status
if "%CHOICE%"=="9" set "TO_INSTALL=tushare stock_news quant_algo web_search xiaohongshu_copy document_parser excel_analyzer data_analysis"
if "%CHOICE%"=="1" set "TO_INSTALL=tushare"
if "%CHOICE%"=="2" set "TO_INSTALL=stock_news"
if "%CHOICE%"=="3" set "TO_INSTALL=quant_algo"
if "%CHOICE%"=="4" set "TO_INSTALL=web_search"
if "%CHOICE%"=="5" set "TO_INSTALL=xiaohongshu_copy"
if "%CHOICE%"=="6" set "TO_INSTALL=document_parser"
if "%CHOICE%"=="7" set "TO_INSTALL=excel_analyzer"
if "%CHOICE%"=="8" set "TO_INSTALL=data_analysis"

if not defined TO_INSTALL (
    echo [错误] 无效选择: %CHOICE%
    exit /b 1
)

echo.
echo 即将验证以下环境: %TO_INSTALL%
echo.

for %%S in (%TO_INSTALL%) do (
    set "SKILL_ENV=%ENV_DIR%\%%S"
    set "DONE_FILE=!SKILL_ENV!\setup.done"
    set "VENV_PATH=!SKILL_ENV!\.venv"

    echo   正在检查 %%S...

    if not exist "!DONE_FILE!" (
        echo   [跳过] %%S 预编译标记不存在
        echo          运行 build-skills-env.bat 重新构建或正确解压 zip
    ) else if not exist "!VENV_PATH!" (
        echo   [警告] %%S .venv 目录不存在
    ) else (
        echo   [OK]   %%S 环境已就绪
        if exist "!DONE_FILE!" type "!DONE_FILE!"
    )
    echo.
)

echo ========================================
echo  环境验证完成
echo  预编译目录: %ENV_DIR%
echo  应用下载 skill 时，管理器会自动复制匹配的 .venv（若存在）。
echo  纯 LLM skill 无需预编译 Python。
echo ========================================
goto :end

:check_status
echo.
echo ========================================
echo  已安装环境状态
echo ========================================
echo.
for %%S in (tushare stock_news quant_algo web_search xiaohongshu_copy document_parser excel_analyzer data_analysis) do (
    set "SKILL_ENV=%ENV_DIR%\%%S"
    set "DONE_FILE=!SKILL_ENV!\setup.done"
    set "VENV_PATH=!SKILL_ENV!\.venv"

    if not exist "!DONE_FILE!" (
        echo   %%S: [未构建]
    ) else if not exist "!VENV_PATH!" (
        echo   %%S: [不完整]
    ) else (
        echo   %%S: [已就绪]
    )
)
echo.
echo ========================================
goto :end

:end
echo.
pause
endlocal
