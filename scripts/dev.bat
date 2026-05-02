@echo off
title CLITrigger - Dev Mode
cd /d "%~dp0.."

REM Kill existing processes on port 3001 and 5173
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001.*LISTENING"') do (
    echo Killing existing process on port 3001 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173.*LISTENING"') do (
    echo Killing existing process on port 5173 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)

REM Verify better-sqlite3 native ABI matches the current Node runtime.
REM build-electron.bat rebuilds it for Electron ABI, which fails under plain Node.
node -e "require('better-sqlite3')" >nul 2>&1
if errorlevel 1 (
    echo.
    echo Native module ABI mismatch detected ^(better-sqlite3^).
    echo Rebuilding for current Node runtime...
    call npm rebuild better-sqlite3
    if errorlevel 1 (
        echo ERROR: npm rebuild better-sqlite3 failed.
        pause
        exit /b 1
    )
    echo Rebuild complete.
    echo.
)

echo ========================================
echo   CLITrigger - Development Mode
echo   Server: http://localhost:3001
echo   Client: http://localhost:5173
echo ========================================
echo.
call npm run dev
pause
