@echo off
setlocal
chcp 65001 >nul
title CLITrigger - Build Windows Installer
cd /d "%~dp0.."
echo ========================================
echo   CLITrigger - Build Windows Installer
echo ========================================
echo.

echo [1/6] Verifying Node dependencies...
if not exist "node_modules\@electron\rebuild" (
  echo   Installing root dependencies including devDeps...
  call npm install
  if errorlevel 1 goto :error
)
if not exist "src\client\node_modules" (
  echo   Installing client dependencies...
  pushd src\client
  call npm install
  set CLIENT_RC=%ERRORLEVEL%
  popd
  if not "%CLIENT_RC%"=="0" goto :error
)
echo   OK
echo.

echo [2/6] Verifying Python build tooling (node-gyp needs distutils)...
python -c "import distutils" >nul 2>&1
if errorlevel 1 (
  echo   distutils missing - installing setuptools shim...
  call python -m pip install --quiet --upgrade setuptools
  if errorlevel 1 (
    echo   ERROR: failed to install setuptools.
    echo   Run manually: python -m pip install setuptools
    goto :error
  )
)
echo   OK
echo.

echo [3/6] Rebuilding native modules for Electron...
call npm run electron:rebuild
if errorlevel 1 goto :error
echo.

echo [4/6] Generating app icons from logo-icon.svg...
call node scripts\generate-icons.cjs
if errorlevel 1 goto :error
echo.

echo [5/6] Building app (server + client)...
call npm run build
if errorlevel 1 goto :error
echo.

echo [6/6] Packaging Windows installer with electron-builder...
call npx electron-builder --win
if errorlevel 1 goto :error

echo.
echo ========================================
echo   Build complete!
echo   Output folder: release\
echo.
echo   Tip: to switch back to "npm run dev",
echo        run: npm rebuild better-sqlite3
echo        electron-rebuild compiled it for Electron ABI.
echo ========================================
goto :end

:error
echo.
echo ========================================
echo   Build FAILED  (errorlevel %ERRORLEVEL%)
echo ========================================
echo See messages above for the failing step.

:end
echo.
pause
endlocal
