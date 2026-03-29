@echo off
title CLITrigger - Type Check
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - TypeScript Type Check
echo ========================================
echo.
call npm run typecheck
echo.
if %errorlevel% neq 0 (
    echo Type check failed!
) else (
    echo Type check passed!
)
pause
