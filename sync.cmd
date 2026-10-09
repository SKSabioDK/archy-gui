@echo off
setlocal

cd /d "%~dp0"

echo.
echo ==========================================
echo   ArchyGUI - Sync Origin to Sabio
echo ==========================================
echo.

echo [1/3] Checking repository...
git status --short
if errorlevel 1 goto error

echo.
echo [2/3] Getting latest version from origin...
git pull --no-rebase --no-edit --autostash origin main
if errorlevel 1 goto error

echo.
echo [3/3] Pushing main to Sabio...
git push sabio main
if errorlevel 1 goto error

echo.
echo ==========================================
echo   SYNC COMPLETED SUCCESSFULLY
echo   origin/main --^> sabio/main
echo ==========================================
echo.
pause
exit /b 0

:error
echo.
echo ==========================================
echo   ERROR - SYNC WAS NOT COMPLETED
echo ==========================================
echo.
git status --short
pause
exit /b 1