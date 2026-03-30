@echo off
title CLITrigger - Dev Mode
cd /d "%~dp0.."

REM Kill existing processes on port 3000 and 5173
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING"') do (
    echo Killing existing process on port 3000 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173.*LISTENING"') do (
    echo Killing existing process on port 5173 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)

echo ========================================
echo   CLITrigger - Development Mode
echo   Server: http://localhost:3000
echo   Client: http://localhost:5173
echo ========================================
echo.
call npm run dev
pause
