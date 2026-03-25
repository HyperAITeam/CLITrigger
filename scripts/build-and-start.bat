@echo off
title CLITrigger - Build and Start
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Build and Start
echo ========================================
echo.
echo Building...
npm run build
if %errorlevel% neq 0 (
    echo.
    echo Build failed!
    pause
    exit /b 1
)
echo.
echo Build complete! Starting server...
echo http://localhost:3000
echo.
npm run start
pause
