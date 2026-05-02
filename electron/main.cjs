const { app, BrowserWindow, dialog, shell, Menu, nativeTheme, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

let mainWindow = null;
let serverPort = null;
let serverPassword = null;
let cleanupStarted = false;

const userDataDir = app.getPath('userData');
const configFile = path.join(userDataDir, 'config.json');
const dbPath = path.join(userDataDir, 'clitrigger.db');

function readOrInitConfig() {
  fs.mkdirSync(userDataDir, { recursive: true });
  let config = {};
  if (fs.existsSync(configFile)) {
    try { config = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}
  }
  let mutated = false;
  if (!config.password) {
    config.password = crypto.randomBytes(16).toString('hex');
    mutated = true;
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
  serverPassword = config.password;
  serverPort = await findFreePort(config.port);

  process.env.PORT = String(serverPort);
  process.env.AUTH_PASSWORD = config.password;
  process.env.DB_PATH = dbPath;
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
  return { port: serverPort, password: config.password };
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#ffffff',
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isLocal = localOrigins.some((o) => url.startsWith(o));
    if (!isLocal) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function showPasswordDialog() {
  const result = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: 'CLITrigger',
    message: 'Login password',
    detail: serverPassword,
    buttons: ['Copy to clipboard', 'Close'],
    defaultId: 0,
    cancelId: 1,
  });
  if (result === 0 && serverPassword) {
    clipboard.writeText(serverPassword);
  }
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
        { label: 'Show login password', click: showPasswordDialog },
        { label: 'Open config folder', click: () => shell.openPath(userDataDir) },
        { type: 'separator' },
        {
          label: 'Open in browser',
          click: () => {
            if (serverPort) shell.openExternal(`http://127.0.0.1:${serverPort}`);
          },
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
    } catch (err) {
      dialog.showErrorBox(
        'CLITrigger failed to start',
        String((err && err.stack) || err)
      );
      app.exit(1);
    }
  });
}
