@echo off
title CLITrigger - Test
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Run All Tests
echo ========================================
echo.
call npm test
echo.
if %errorlevel% neq 0 (
    echo Tests failed!
) else (
    echo All tests passed!
)
pause
