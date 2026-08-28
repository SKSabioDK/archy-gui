@echo off
title Archy GUI

echo Starting Archy GUI...

REM Kill any existing instance on port 3737
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3737 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Norton (og andre TLS-inspicerende proxyer) gensignerer HTTPS med et eget
REM root-CA, som kun ligger i Windows' certifikatlager — ikke i Nodes indbyggede.
REM --use-system-ca faar Node til at bruge Windows-lageret. Flaget kraever
REM Node >= 22.15; findes det ikke, startes uden.
set "NODE_FLAGS=--use-system-ca"
node --use-system-ca -e "" >nul 2>&1 || set "NODE_FLAGS="

REM Start server in background
start /B node %NODE_FLAGS% "%~dp0server.js" > "%~dp0server.log" 2>&1

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
