@echo off
title CLITrigger - Build
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Build
echo ========================================
echo.
npm run build
echo.
echo Build complete!
pause
