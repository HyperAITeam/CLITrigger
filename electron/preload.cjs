const { contextBridge, ipcRenderer } = require('electron');

// `imeReset` calls `webContents.focus()` in the main process to recover the
// native HWND keyboard focus when it gets stuck on xterm's helper textarea
// after a session has been interacted with — Korean IME on Windows EXE
// otherwise requires the user to alt-tab away and back to type into the
// SessionForm inputs.
// `imeLog` forwards renderer-side IME diagnostics to the main process, which
// appends them to userData/ime-debug.log — but only when CLITRIGGER_IME_DEBUG
// is set. The packaged exe has no visible console, and opening DevTools masks
// the occlusion bug (an un-occluded window never reproduces it), so a file log
// is the only way to observe compositionstart state during a real repro.
contextBridge.exposeInMainWorld('electronAPI', {
  imeReset: () => ipcRenderer.send('ime:reset'),
  imeLog: (payload) => ipcRenderer.send('ime:log', payload),
  // Toggle IME file logging at runtime (Settings ▸ Terminal). Persisted in
  // session settings; the renderer re-sends the saved value on startup.
  imeSetDebug: (enabled) => ipcRenderer.send('ime:set-debug', enabled),
  // Raise this window's BrowserWindow to the front (restore if minimized).
  // A renderer's own window.focus() can't do this — Chromium requires user
  // activation the caller doesn't have when reacting to a bus message. Used
  // by popout windows when the main window's dock chip asks them to front.
  windowFocus: () => ipcRenderer.send('window:focus-self'),
});
