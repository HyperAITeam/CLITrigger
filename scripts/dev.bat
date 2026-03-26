@echo off
title CLITrigger - Dev Mode
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Development Mode
echo   Server: http://localhost:3000
echo   Client: http://localhost:5173
echo ========================================
echo.
call npm run dev
pause
