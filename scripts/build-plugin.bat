@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo [1/5] Building client...
call npm run build:client
if errorlevel 1 (echo Client build failed & pause & exit /b 1)

echo [2/5] Building server...
call npm run build:server
if errorlevel 1 (echo Server build failed & pause & exit /b 1)

echo [3/5] Bundling server with esbuild...
if not exist "plugin-build\server\native" mkdir "plugin-build\server\native"
if not exist "plugin-build\lib" mkdir "plugin-build\lib"

call npx esbuild dist/server/index.js --bundle --platform=node --format=esm ^
  --outfile=plugin-build/server/server.js ^
  --external:better-sqlite3 --external:node-pty
if errorlevel 1 (echo esbuild failed & pause & exit /b 1)

echo [4/5] Copying native binaries and resources...

:: Copy native .node binaries using node script (bat for-loop is fragile)
node -e "const fs=require('fs'),p=require('path');function copyNode(dir,dest){if(!fs.existsSync(dir))return;for(const f of fs.readdirSync(dir,{recursive:true})){const fp=p.join(dir,f);if(fp.endsWith('.node')&&fs.statSync(fp).isFile()){fs.copyFileSync(fp,p.join(dest,p.basename(fp)));console.log('  copied: '+p.basename(fp))}}}copyNode('node_modules/better-sqlite3','plugin-build/server/native');copyNode('node_modules/node-pty','plugin-build/server/native')"

:: Copy server resources (gstack skills etc)
if exist "dist\server\resources" (
  echo   copying server resources...
  xcopy /E /I /Y "dist\server\resources" "plugin-build\server\resources" >nul 2>&1
)

:: Copy client dist for browser UI
if exist "src\client\dist" (
  echo   copying client dist...
  xcopy /E /I /Y "src\client\dist" "plugin-build\client\dist" >nul 2>&1
)

:: Copy plugin files
echo   copying plugin files...
copy /Y "plugin\plugin.json" "plugin-build\" >nul
copy /Y "plugin\main.js" "plugin-build\" >nul
copy /Y "plugin\lib\*.js" "plugin-build\lib\" >nul

echo [5/5] Creating ZIP...
if exist "clitrigger-plugin.zip" del "clitrigger-plugin.zip"
cd plugin-build
tar -cf "..\clitrigger-plugin.zip" -a *
cd ..

echo.
echo ========================================
echo Plugin built: clitrigger-plugin.zip
echo ========================================
echo.
echo To install:
echo   1. Extract to %%LOCALAPPDATA%%\.hecaton\plugins\clitrigger\
echo   2. Restart Hecaton
echo   3. Open plugin from tab menu
echo.
pause

endlocal
