@echo off
pushd "%~dp0.."

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1

node -e "new (require('better-sqlite3'))(':memory:').close()" >nul 2>&1
if errorlevel 1 (
    echo.
    echo Native module ABI mismatch detected ^(better-sqlite3^).
    echo Rebuilding for current Node runtime...
    if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" del /q "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
    call npm rebuild better-sqlite3
    if errorlevel 1 (
        echo ERROR: npm rebuild better-sqlite3 failed.
        pause
        exit /b 1
    )
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
