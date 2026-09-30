@echo off
title Archy GUI

REM Serveren startes skjult i baggrunden og lever videre, naar dette vindue
REM lukker. Stop den med stop.bat. Output: server.log, fejl: server.err.log.

if not defined PORT set "PORT=3737"
echo Starting Archy GUI on port %PORT%...

REM Stop en tidligere instans paa porten
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Norton (og andre TLS-inspicerende proxyer) gensignerer HTTPS med et eget
REM root-CA, som kun ligger i Windows' certifikatlager — ikke i Nodes indbyggede.
REM --use-system-ca faar Node til at bruge Windows-lageret. Flaget kraever
REM Node >= 22.15; findes det ikke, startes uden.
set "NODE_FLAGS=--use-system-ca"
node --use-system-ca -e "" >nul 2>&1 || set "NODE_FLAGS="

REM Start /B hang paa dette vindue, saa serveren doede naar det blev lukket.
REM Start-Process giver en selvstaendig, skjult proces.
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList '%NODE_FLAGS% \"%~dp0server.js\"' -WorkingDirectory '%~dp0.' -WindowStyle Hidden -RedirectStandardOutput '%~dp0server.log' -RedirectStandardError '%~dp0server.err.log'"

REM Vent paa serveren — hoejst 30 sekunder
echo Waiting for server...
set /a TRIES=0
:wait
ping -n 2 127.0.0.1 >nul
curl -s http://localhost:%PORT%/api/version >nul 2>&1
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% lss 30 goto wait
echo.
echo The server did not start. Last lines of server.err.log:
powershell -NoProfile -Command "Get-Content '%~dp0server.err.log' -Tail 15"
pause
exit /b 1

:ready
if not defined ARCHY_NO_BROWSER start "" http://localhost:%PORT%
echo Archy GUI is running on http://localhost:%PORT% in the background.
echo You can close this window. Stop the server with stop.bat.
ping -n 5 127.0.0.1 >nul
exit /b 0
