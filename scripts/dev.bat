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
REM NOTE: must instantiate Database to trigger the dlopen — `require()` alone
REM only loads the JS wrapper and the .node binding is lazy-loaded on `new Database()`.
node -e "new (require('better-sqlite3'))(':memory:').close()" >nul 2>&1
if errorlevel 1 (
    echo.
    echo Native module ABI mismatch detected ^(better-sqlite3^).
    echo Rebuilding for current Node runtime...
    REM `npm rebuild` reports success but skips replacing the .node file when one
    REM already exists, so we delete the stale binary first to force a fresh
    REM prebuild-install/node-gyp run targeting the current Node ABI.
    if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
        del /q "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
    )
    call npm rebuild better-sqlite3
    if errorlevel 1 (
        echo ERROR: npm rebuild better-sqlite3 failed.
        pause
        exit /b 1
    )
    REM Confirm the rebuild actually produced a binary loadable under this Node.
    node -e "new (require('better-sqlite3'))(':memory:').close()" >nul 2>&1
    if errorlevel 1 (
        echo ERROR: better-sqlite3 still mismatched after rebuild.
        echo Try: rmdir /s /q node_modules\better-sqlite3 ^&^& npm install
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
