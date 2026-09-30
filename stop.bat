@echo off
title Archy GUI - stop

REM Stopper serveren som start.bat har startet i baggrunden.
if not defined PORT set "PORT=3737"

set "FOUND="
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    set "FOUND=1"
)

if defined FOUND (
    echo Archy GUI on port %PORT% has been stopped.
) else (
    echo Archy GUI is not running on port %PORT%.
)
ping -n 4 127.0.0.1 >nul
