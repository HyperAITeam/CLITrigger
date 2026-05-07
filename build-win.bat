@echo off
setlocal

set SKIP_INSTALL=0
set BUILD_MSIX=0

:parse_args
if "%1"=="--skip-install" (set SKIP_INSTALL=1 & shift & goto :parse_args)
if "%1"=="-s"             (set SKIP_INSTALL=1 & shift & goto :parse_args)
if "%1"=="--msix"         (set BUILD_MSIX=1   & shift & goto :parse_args)

if %SKIP_INSTALL%==1 (
  echo [1/4] Skipping server dependencies (--skip-install)
) else (
  echo [1/4] Installing server dependencies...
  call npm ci
  if errorlevel 1 goto :error
)

if %SKIP_INSTALL%==1 (
  echo [2/4] Skipping client dependencies (--skip-install)
) else (
  echo [2/4] Installing client dependencies...
  cd src\client
  call npm ci
  if errorlevel 1 goto :error
  cd ..\..
)

echo [3/4] Rebuilding native modules for Electron...
call npm run electron:rebuild
if errorlevel 1 goto :error

if %BUILD_MSIX%==1 (
  echo [4/4] Building Windows MSIX...

  if not exist build-cert.pfx (
    echo   Generating self-signed certificate...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=CLITrigger Dev' -KeyUsage DigitalSignature -FriendlyName 'CLITrigger Dev' -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}'); $pwd = ConvertTo-SecureString -String 'clitrigger' -Force -AsPlainText; Export-PfxCertificate -Cert $cert -FilePath 'build-cert.pfx' -Password $pwd | Out-Null; Write-Host '  Certificate saved to build-cert.pfx'"
    if errorlevel 1 goto :error
  ) else (
    echo   Using existing build-cert.pfx
  )

  set CSC_LINK=build-cert.pfx
  set CSC_KEY_PASSWORD=clitrigger
  call npx electron-builder --win appx --publish never
  if errorlevel 1 goto :error

  echo.
  echo Done! Output in release\
  echo.
  echo NOTE: To install this MSIX on this PC, run once as admin:
  echo   powershell -Command "Import-PfxCertificate -FilePath build-cert.pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password (ConvertTo-SecureString clitrigger -AsPlainText -Force)"
) else (
  echo [4/4] Building Windows EXE...
  call npx electron-builder --win --publish never
  if errorlevel 1 goto :error

  echo.
  echo Done! Output in release\
)

goto :end

:error
echo.
echo Build failed.
exit /b 1

:end
endlocal
