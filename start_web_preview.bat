@echo off
setlocal
cd /d "%~dp0"
python -m pip show requests >nul 2>nul
if errorlevel 1 (
  python -m pip install -r requirements.txt
)
python web_preview_server.py
