@echo off
setlocal
rem ============================================================================
rem  Start the euroleghe-ingest toolkit.
rem   - Double-click (no arguments)    -> opens the WINDOW (operator panel)
rem   - From a terminal with arguments -> runs the CLI
rem       examples:  toolkit-start.cmd rebuild
rem                  toolkit-start.cmd validate
rem                  toolkit-start.cmd --help
rem ============================================================================
set "SCRIPTS=%~dp0toolkit\.venv\Scripts"

if not exist "%SCRIPTS%\euroleghe-ingest.exe" (
    echo.
    echo [ERROR] Toolkit Python environment not found in:
    echo   %SCRIPTS%
    echo.
    echo Create it once with:
    echo   cd /d "%~dp0toolkit"
    echo   python -m venv .venv ^&^& .venv\Scripts\python -m pip install -e ".[dev]"
    echo.
    pause
    exit /b 1
)

if "%~1"=="" (
    rem No arguments: open the window and release this console immediately.
    start "" "%SCRIPTS%\euroleghe-ingest-gui.exe"
) else (
    rem With arguments: run the CLI, forwarding everything that follows.
    "%SCRIPTS%\euroleghe-ingest.exe" %*
)
endlocal
