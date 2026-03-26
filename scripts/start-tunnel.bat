@echo off
title CLITrigger - Tunnel Mode
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Tunnel Mode
echo   Local: http://localhost:3000
echo   Tunnel URL will appear below
echo ========================================
echo.
call npm run start:tunnel
pause
