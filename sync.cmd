@echo off
setlocal

cd /d "%~dp0"

echo.
echo ==========================================
echo   ArchyGUI - Sync repositories
echo ==========================================
echo.

echo [1/4] Checking repository...
git status --short
if errorlevel 1 goto error

echo.
echo [2/4] Getting latest version from origin...
git pull --ff-only origin main
if errorlevel 1 goto error

echo.
echo [3/4] Pushing to primary repository...
git push origin main
if errorlevel 1 goto error

echo.
echo [4/4] Synchronizing to Sabio repository...
git push sabio main
if errorlevel 1 goto error

echo.
echo ==========================================
echo   SYNC COMPLETED SUCCESSFULLY
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
echo Check the Git error above.
echo.
pause
exit /b 1
