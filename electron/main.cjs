const { app, BrowserWindow, dialog, shell, Menu, nativeTheme, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

// Windows: Chromium의 네이티브 윈도우 가림 계산이 창을 잘못 "가려짐"으로 판정하면
// 입력/IME가 멎고 IME 조합 창이 화면 좌상단에 고착된다(다른 앱에 포커스를 줬다
// 오면 가림 재계산이 일어나며 풀림). 패키징 exe에서만 재현 — dev는 detached
// DevTools가 떠 있어 가려진다. 이 기능을 끄면 고착이 사라진다.
// 참고: electron/electron#4539, #31917.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

let mainWindow = null;
let serverPort = null;
let cleanupStarted = false;
let updateCheckInFlight = false;

const userDataDir = app.getPath('userData');
const configFile = path.join(userDataDir, 'config.json');
const dbPath = path.join(userDataDir, 'clitrigger.db');
const migratedFlag = path.join(userDataDir, '.password-migrated');

function readOrInitConfig() {
  fs.mkdirSync(userDataDir, { recursive: true });
  let config = {};
  if (fs.existsSync(configFile)) {
    try { config = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}
  }
  let mutated = false;
  // Password is set by the user on first launch via the web UI Setup screen.
  // Legacy plaintext field is migrated to a hash on first server boot, then
  // cleaned up here on the next launch via the migrated flag.
  if (fs.existsSync(migratedFlag) && config.password) {
    delete config.password;
    mutated = true;
    try { fs.unlinkSync(migratedFlag); } catch { /* ignore */ }
  }
  if (typeof config.port !== 'number') {
    config.port = 3737;
    mutated = true;
  }
  if (typeof config.tunnel !== 'boolean') {
    config.tunnel = false;
    mutated = true;
  }
  if (mutated) fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return config;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start) {
  for (let p = start; p < start + 50; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('No free port available');
}

async function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not respond on port ${port} within ${timeoutMs}ms`);
}

function resolveServerEntry() {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'server', 'index.js'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist', 'server', 'index.js'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

async function bootServer() {
  const config = readOrInitConfig();
  serverPort = await findFreePort(config.port);

  process.env.PORT = String(serverPort);
  process.env.DB_PATH = dbPath;
  // Only forward a legacy plaintext password so the server can migrate it.
  // Without it, the server enters setup mode and the web UI prompts the user.
  if (config.password) {
    process.env.AUTH_PASSWORD = config.password;
  }
  if (config.tunnel) process.env.TUNNEL_ENABLED = 'true';
  if (config.tunnelName) process.env.TUNNEL_NAME = config.tunnelName;
  if (config.tunnelHostname) process.env.TUNNEL_HOSTNAME = config.tunnelHostname;

  const serverEntry = resolveServerEntry();
  if (!serverEntry) {
    throw new Error(
      'Server build not found. Run "npm run build" before launching Electron.'
    );
  }
  await import(pathToFileURL(serverEntry).href);
  await waitForServer(serverPort);
  return { port: serverPort };
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#ffffff',
    // Dev only — packaged build inherits the icon from the embedded .exe.
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '..', 'build', 'icon.png') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const localOrigins = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ];
  // Parse a `features` CSV string like "popup,width=800,height=540,left=120,top=80"
  // into numeric x/y/width/height we can forward into Electron's
  // overrideBrowserWindowOptions. Electron drops the features-derived sizing
  // when override is returned, so this re-forwards what the renderer asked
  // for; without it the popout would spawn at Electron's default cascade
  // position instead of under the user's cursor (drag-out is unusable).
  const parseFeatures = (features) => {
    const out = {};
    if (typeof features !== 'string') return out;
    for (const part of features.split(',')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      const val = Number(part.slice(eq + 1).trim());
      if (!Number.isFinite(val)) continue;
      if (key === 'width') out.width = val;
      else if (key === 'height') out.height = val;
      else if (key === 'left') out.x = val;
      else if (key === 'top') out.y = val;
    }
    return out;
  };

  mainWindow.webContents.setWindowOpenHandler(({ url, features }) => {
    const isLocal = localOrigins.some((o) => url.startsWith(o));
    if (!isLocal) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // Session pop-out windows: open as a real OS child window with the same
    // preload + isolation as the main window. Without overrideBrowserWindowOptions
    // Electron uses small defaults and doesn't apply the preload, which
    // breaks IME reset + auto-updater bridges the popout may also call.
    let popoutPath;
    try { popoutPath = new URL(url).pathname; } catch { popoutPath = ''; }
    if (popoutPath.startsWith('/popout/')) {
      const feat = parseFeatures(features);
      // Hide the native title bar + app menu (File/Edit/…) for popouts.
      // PopoutPage renders its own 28px top bar (label / re-dock / close) and
      // marks it as a -webkit-app-region drag handle so the window can still
      // be moved. thickFrame stays default → edge resize + shadow remain.
      //
      // Platform split: a fully frameless window (`frame: false`) on Windows
      // never establishes an IME context, so OS Hangul/CJK composition events
      // don't fire and the terminal silently drops composed input (ASCII still
      // works). `titleBarStyle: 'hidden'` keeps the window OS-managed (IME
      // works) while hiding the title bar. macOS/Linux keep `frame: false`
      // (IME unaffected there). Main window is unaffected either way.
      const framelessOpts = process.platform === 'win32'
        ? { titleBarStyle: 'hidden' }
        : { frame: false };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...framelessOpts,
          width: feat.width || 800,
          height: feat.height || 540,
          // x/y intentionally only forwarded when supplied — Electron treats
          // an absent x/y as "let the OS place the window" which is the right
          // default for the button-click path.
          ...(typeof feat.x === 'number' ? { x: feat.x } : {}),
          ...(typeof feat.y === 'number' ? { y: feat.y } : {}),
          minWidth: 360,
          minHeight: 240,
          backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#ffffff',
          webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
          },
        },
      };
    }
    return { action: 'allow' };
  });

  // Newly-created child windows (popouts) inherit the main window's
  // setWindowOpenHandler but not the lock-screen focus-recovery handler.
  // Attach the same focus → webContents.focus() bridge so xterm typing
  // doesn't go dead after resume.
  mainWindow.webContents.on('did-create-window', (childWin) => {
    childWin.on('focus', () => {
      if (!childWin.isDestroyed()) childWin.webContents.focus();
    });
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  // Windows lock-screen / screensaver hands the native HWND keyboard focus
  // off to the lock UI; on resume it doesn't always return to webContents,
  // leaving every input (SessionForm, SessionTerminal) dead until the user
  // minimizes and restores. Re-focus webContents on every window focus event
  // so the OS-level focus is always routed back into the renderer.
  mainWindow.on('focus', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.focus();
  });
}

ipcMain.on('ime:reset', (event) => {
  // Route the focus call to the sender's webContents so popout child
  // windows reclaim their own keyboard focus, not the main window's.
  // Falls back to mainWindow only if the sender is gone (race during
  // teardown).
  const sender = event && event.sender;
  if (sender && !sender.isDestroyed()) {
    sender.focus();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.focus();
  }
});

function checkForUpdates({ silent } = { silent: true }) {
  if (!app.isPackaged) {
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: '개발 모드에서는 업데이트 확인을 사용할 수 없습니다.',
      });
    }
    return;
  }
  if (updateCheckInFlight) return;
  updateCheckInFlight = true;
  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      console.error('[updater] check failed:', (err && err.message) || err);
      if (!silent && mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '업데이트 확인 실패',
          message: '업데이트를 확인하는 중 오류가 발생했습니다.',
          detail: String((err && err.message) || err),
        });
      }
    })
    .finally(() => {
      updateCheckInFlight = false;
    });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', (err && err.message) || err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info && info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up-to-date');
  });

  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] downloading ${Math.round(p.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['지금 재시작', '나중에'],
        defaultId: 0,
        cancelId: 1,
        title: 'CLITrigger 업데이트 준비 완료',
        message: `새 버전 ${info && info.version}이(가) 다운로드되었습니다.`,
        detail: '지금 재시작하면 업데이트가 적용됩니다. 나중에 선택 시 다음 종료 시점에 자동 설치됩니다.',
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
      });
  });

  setTimeout(() => checkForUpdates({ silent: true }), 5000);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Open config folder', click: () => shell.openPath(userDataDir) },
        { type: 'separator' },
        {
          label: 'Open in browser',
          click: () => {
            if (serverPort) shell.openExternal(`http://127.0.0.1:${serverPort}`);
          },
        },
        { type: 'separator' },
        {
          label: '업데이트 확인',
          click: () => checkForUpdates({ silent: false }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
    createWindow(serverPort);
  }
});

app.on('before-quit', (event) => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  event.preventDefault();
  process.emit('SIGTERM');
  setTimeout(() => app.exit(0), 5000);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const { port } = await bootServer();
      buildMenu();
      createWindow(port);
      setupAutoUpdater();
    } catch (err) {
      dialog.showErrorBox(
        'CLITrigger failed to start',
        String((err && err.stack) || err)
      );
      app.exit(1);
    }
  });
}
