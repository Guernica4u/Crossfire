@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
start "" wscript.exe "%~dp0Crossfire.vbs"
exit /b 0
