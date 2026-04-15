@echo off
title Archy GUI

echo Starting Archy GUI...

REM Kill any existing instance on port 3737
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3737 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Start server in background
start /B node "%~dp0server.js" > "%~dp0server.log" 2>&1

REM Wait for server to be ready
echo Waiting for server...
:wait
timeout /t 1 /nobreak >nul
curl -s http://localhost:3737/api/logs >nul 2>&1
if errorlevel 1 goto wait

REM Open browser
start "" http://localhost:3737

echo Archy GUI is running on http://localhost:3737
echo Close this window to stop the server.
echo.

REM Keep window open (stopping it kills the server)
:loop
timeout /t 60 /nobreak >nul
goto loop
