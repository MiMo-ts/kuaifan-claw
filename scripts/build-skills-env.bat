@echo off
setlocal enabledelayedexpansion

echo ========================================
echo  Skill Environment Prebuild Script
echo ========================================
echo.

set "PROJECT_DIR=%~dp0.."
set "ENV_DIR=%PROJECT_DIR%\scripts\data\skills-env"
set "ZIP_SRC=%PROJECT_DIR%\scripts\data\skills-env"
set "ZIP_DST=%PROJECT_DIR%\scripts\skills-env-offline.zip"
set "PYTHON="

REM === 自动查找 Python 3.13+（优先 PATH 中的 python，兜底 %LOCALAPPDATA%\Programs\Python\） ===
REM 尝试从 PATH 中找
for /f "delims=" %%P in ('where python 2^>nul') do (
    if not defined PYTHON (
        for /f "delims=" %%V in ('python --version 2^>nul') do (
            echo   Found in PATH: %%P
            set "PYTHON=%%P"
            goto :python_found
        )
    )
)

REM PATH 中没有，扫描 %LOCALAPPDATA%\Programs\Python\
for /f "delims=" %%F in ('dir /b /o-n "%LOCALAPPDATA%\Programs\Python\Python3*" 2^>nul') do (
    if /i "%%F" geq "Python313" (
        if exist "%LOCALAPPDATA%\Programs\Python\%%F\python.exe" (
            set "PYTHON=%LOCALAPPDATA%\Programs\Python\%%F\python.exe"
            goto :python_found
        )
    )
)

REM 硬编码兜底（仍用 %LOCALAPPDATA%，不写死 C:\Users\Administrator\）
if not defined PYTHON set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"

:python_found

REM Aligns with robot.rs link_prebuilt_skill_env() + builtin templates:
REM   tushare, stock_news, quant_algo, web_search, xiaohongshu_copy
REM   document_parser, excel_analyzer, data_analysis
set "SKILL_IDS=tushare stock_news quant_algo web_search xiaohongshu_copy document_parser excel_analyzer data_analysis"

if not exist "%ENV_DIR%" mkdir "%ENV_DIR%"
echo   Env dir: %ENV_DIR%
echo.

REM === create_venv VENV_DIR ===
:create_venv
set "VDIR=%~1\.venv"
if exist "%VDIR%" rd /s /q "%VDIR%"
"%PYTHON%" -m venv "%VDIR%"
if exist "%VDIR%\Scripts\python.exe" (exit /b 0) else (exit /b 1)
goto :eof

REM === pip_install VENV_DIR PKG1 PKG2 ... ===
:pip_install
set "VDIR=%~1\.venv\Scripts\pip.exe"
shift
:pip_loop
if "%~1"=="" goto :pip_done
"%VDIR%" install "%~1" >nul 2>&1
shift
goto :pip_loop
:pip_done
exit /b 0
goto :eof

REM ================================================================
REM MAIN
REM ================================================================

echo [Step 1/6] Checking Python...
if not exist "%PYTHON%" (
    echo   [ERROR] Python 3.13 not found.
    echo   Install Python 3.13+ or ensure 'python' is in your PATH.
    goto :build_error
)
echo   Python OK
echo.

echo [Step 2/6] Cleaning old prebuilt envs...
for %%S in (%SKILL_IDS%) do (
    if exist "%ENV_DIR%\%%S\.venv" rd /s /q "%ENV_DIR%\%%S\.venv" 2>nul
    if exist "%ENV_DIR%\%%S\setup.done" del /q "%ENV_DIR%\%%S\setup.done" 2>nul
)
echo   Clean done
echo.

echo [Step 3/6] Creating skill Python environments...
echo.

echo   [tushare] ...
call :create_venv "%ENV_DIR%\tushare"
if errorlevel 1 (echo   [ERROR] tushare venv failed && goto :build_error)
call :pip_install "%ENV_DIR%\tushare" tushare "pandas>=2.0.0" "openpyxl>=3.1.0"
echo   [tushare] done
echo.

echo   [stock_news] ...
call :create_venv "%ENV_DIR%\stock_news"
if errorlevel 1 (echo   [ERROR] stock_news venv failed && goto :build_error)
call :pip_install "%ENV_DIR%\stock_news" yfinance pandas rich matplotlib mplfinance
echo   [stock_news] done
echo.

echo   [quant_algo] ...
call :create_venv "%ENV_DIR%\quant_algo"
if errorlevel 1 (echo   [ERROR] quant_algo venv failed && goto :build_error)
call :pip_install "%ENV_DIR%\quant_algo" yfinance rich pandas plotille matplotlib mplfinance ddgs
echo   [quant_algo] done
echo.

echo   [web_search] (stdlib only)...
call :create_venv "%ENV_DIR%\web_search"
if errorlevel 1 (echo   [ERROR] web_search venv failed && goto :build_error)
echo   [web_search] done
echo.

echo   [xiaohongshu_copy] ...
call :create_venv "%ENV_DIR%\xiaohongshu_copy"
if errorlevel 1 (echo   [ERROR] xiaohongshu_copy venv failed && goto :build_error)
call :pip_install "%ENV_DIR%\xiaohongshu_copy" requests
echo   [xiaohongshu_copy] done
echo.

REM document_parser: matches LeoYeAI/openclaw-master-skills document-parser/requirements.txt
echo   [document_parser] ...
call :create_venv "%ENV_DIR%\document_parser"
if errorlevel 1 (echo   [ERROR] document_parser venv failed && goto :build_error)
call :pip_install "%ENV_DIR%\document_parser" "requests>=2.28.0" "python-docx>=0.8.11" "Pillow>=9.0.0"
echo   [document_parser] done
echo.

REM excel_analyzer: pandas+openpyxl for xlsx processing
echo   [excel_analyzer] ...
call :create_venv "%ENV_DIR%\excel_analyzer"
if errorlevel 1 (echo   [ERROR] excel_analyzer venv failed && goto :build_error)
call :pip_install "%ENV_DIR%\excel_analyzer" "pandas>=2.0.0" "openpyxl>=3.1.0" "numpy>=1.24"
echo   [excel_analyzer] done
echo.

REM data_analysis: pandas+numpy for data analysis
echo   [data_analysis] ...
call :create_venv "%ENV_DIR%\data_analysis"
if errorlevel 1 (echo   [ERROR] data_analysis venv failed && goto :build_error)
call :pip_install "%ENV_DIR%\data_analysis" "pandas>=2.0.0" "numpy>=1.24"
echo   [data_analysis] done
echo.

echo [Step 4/6] Writing markers...
for %%S in (%SKILL_IDS%) do (
    (echo python_version=3.13& echo build_time=prebuilt& echo skill=%%S) > "%ENV_DIR%\%%S\setup.done"
)
echo   Markers done
echo.

echo [Step 5/6] Packaging offline zip...
if exist "%ZIP_DST%" del /q "%ZIP_DST%"
powershell -Command "Compress-Archive -Path '%ZIP_SRC%' -DestinationPath '%ZIP_DST%' -Force"
if errorlevel 1 (echo   [ERROR] zip failed && goto :build_error)
echo   Zip done: %ZIP_DST%
echo.

echo [Step 6/6] Verifying...
for %%S in (%SKILL_IDS%) do (
    if exist "%ENV_DIR%\%%S\.venv\Scripts\python.exe" (
        echo   [OK] %%S
    ) else (
        echo   [WARN] %%S missing python.exe
    )
)
echo.

echo ========================================
echo  Prebuild COMPLETE
echo.
echo  Env dir:   %ENV_DIR%
echo  Zip:       %ZIP_DST%
echo.
echo  Includes (aligned with robot.rs link_prebuilt_skill_env^):
echo    tushare, stock_news, quant_algo
echo    web_search, xiaohongshu_copy
echo    document_parser, excel_analyzer, data_analysis
echo.
echo  Pure-LLM skills (copywriter, doc_writer, ppt_generator etc.)
echo  are SKIPPED - no Python venv needed.
echo ========================================
goto :end

:build_error
echo.
echo ========================================
echo  [ERROR] Prebuild FAILED
echo ========================================
goto :end

REM :end
REM echo.
REM pause
endlocal
