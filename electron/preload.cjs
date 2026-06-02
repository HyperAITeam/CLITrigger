const { contextBridge, ipcRenderer } = require('electron');

// `imeReset` calls `webContents.focus()` in the main process to recover the
// native HWND keyboard focus when it gets stuck on xterm's helper textarea
// after a session has been interacted with — Korean IME on Windows EXE
// otherwise requires the user to alt-tab away and back to type into the
// SessionForm inputs.
contextBridge.exposeInMainWorld('electronAPI', {
  imeReset: () => ipcRenderer.send('ime:reset'),
  // Opens a native file picker and resolves to the chosen executable/script
  // path (or null if cancelled). Used by the favorites form's "Browse" button.
  openExecutableDialog: () => ipcRenderer.invoke('dialog:openExecutable'),
});
