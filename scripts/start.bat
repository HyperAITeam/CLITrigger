@echo off
title CLITrigger - Production
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Production Mode
echo   http://localhost:3000
echo ========================================
echo.
call npm run start
pause
