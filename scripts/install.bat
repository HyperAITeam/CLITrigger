@echo off
title CLITrigger - Install Dependencies
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Install Dependencies
echo ========================================
echo.
echo [1/2] Installing server dependencies...
call npm install
echo.
echo [2/2] Installing client dependencies...
cd src\client && call npm install && cd ..\..
echo.
echo All dependencies installed!
pause
