@echo off
setlocal
cd /d "%~dp0"
conda run --no-capture-output -n ai-sop-demo python server.py
if errorlevel 1 (
    echo.
    echo Failed to start. Make sure Conda and the ai-sop-demo environment are available.
    pause
)
