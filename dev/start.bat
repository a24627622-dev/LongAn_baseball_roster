@echo off
REM LongAn baseball - start local dev server (double-click this file)
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
start "" http://localhost:8080/lineup.html
node dev\server.js
pause
