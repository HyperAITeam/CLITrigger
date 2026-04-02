// CLITrigger Hecaton Plugin — main entry point
// Runs in Deno via Hecaton's deno_runner (CommonJS compatible)
//
// Architecture:
//   1. Spawns CLITrigger Node.js server as a child process (sidecar)
//   2. Renders TUI dashboard in Hecaton terminal cell (ANSI/VT-100)
//   3. Communicates with server via HTTP/WebSocket on localhost

const path = require("path");
const { ServerManager } = require("./lib/server-manager.js");
const { ApiClient } = require("./lib/api-client.js");
const { TUI } = require("./lib/tui.js");

// hecaton global API (injected by deno_runner)
const heca = globalThis.hecaton;

// ===== Config =====
const SERVER_PORT = 3000; // CLITrigger server port (default)

// ===== State =====
let api = null;
let tui = null;
let refreshInterval = null;
let inputPromptActive = false;
let inputBuffer = "";
let inputCallback = null;
let inputLabel = "";

// ===== Server Manager =====
const serverManager = new ServerManager({
  port: SERVER_PORT,
  onReady: (port) => {
    api = new ApiClient(serverManager.getBaseUrl());
    heca.set_title({ title: `CLITrigger :${port}` });
    tui.setStatus(`Server ready on port ${port}`, 3000);

    // Connect WebSocket for real-time updates
    api.connectWebSocket((msg) => {
      handleWsMessage(msg);
    });

    // Initial data load
    loadProjects();
  },
  onError: (err) => {
    tui.setStatus(`Server error: ${err.message}`, 5000);
    heca.notify({ title: "CLITrigger", body: `Server error: ${err.message}` });
  },
  onExit: (code) => {
    tui.setStatus(`Server exited (code ${code}). Press [r] to restart.`, 0);
  },
});

// ===== TUI Setup =====
tui = new TUI();

// ===== WebSocket event handler =====
function handleWsMessage(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === "todo:status-changed" || msg.type === "project:status-changed") {
    // Refresh current view
    if (tui.view === "projects") {
      loadProjects();
    } else if (tui.view === "tasks" && tui.currentProject) {
      loadTodos(tui.currentProject.id);
    }
  }

  if (msg.type === "task:logs" && tui.view === "logs" && tui.currentTodo) {
    if (msg.todoId === tui.currentTodo.id && msg.log) {
      tui.appendLog(msg.log);
    }
  }

  // Notify on task completion/failure
  if (msg.type === "todo:status-changed") {
    if (msg.status === "done") {
      heca.notify({ title: "CLITrigger", body: `Task completed: ${msg.title || ""}` });
    } else if (msg.status === "failed") {
      heca.notify({ title: "CLITrigger", body: `Task failed: ${msg.title || ""}` });
    }
  }
}

// ===== Data loading =====
async function loadProjects() {
  if (!api) return;
  try {
    const projects = await api.getProjects();
    if (Array.isArray(projects)) {
      tui.updateProjects(projects);
    }
  } catch {}
}

async function loadTodos(projectId) {
  if (!api) return;
  try {
    const todos = await api.getTodos(projectId);
    if (Array.isArray(todos)) {
      tui.updateTodos(todos);
    }
  } catch {}
}

async function loadLogs(todoId) {
  if (!api) return;
  try {
    const logs = await api.getTodoLogs(todoId);
    if (Array.isArray(logs)) {
      tui.logs = logs;
      tui.render();
    }
  } catch {}
}

// ===== Simple text input prompt =====
function startInput(label, callback) {
  inputPromptActive = true;
  inputBuffer = "";
  inputCallback = callback;
  inputLabel = label;
  renderInputPrompt();
}

function renderInputPrompt() {
  const CSI = "\x1b[";
  process.stdout.write(CSI + (tui.rows) + ";1H");
  process.stdout.write(CSI + "2K"); // clear line
  process.stdout.write(
    "\x1b[44m\x1b[37m " + inputLabel + ": " + inputBuffer + "\x1b[K\x1b[0m\x1b[49m"
  );
  process.stdout.write("\x1b[?25h"); // show cursor
}

function handleInputKey(data) {
  if (data === "\r" || data === "\n") {
    // Enter — submit
    inputPromptActive = false;
    process.stdout.write("\x1b[?25l"); // hide cursor
    const value = inputBuffer;
    inputBuffer = "";
    if (inputCallback) inputCallback(value);
    return;
  }
  if (data === "\x1b" || data === "\x03") {
    // Escape or Ctrl+C — cancel
    inputPromptActive = false;
    inputBuffer = "";
    process.stdout.write("\x1b[?25l");
    tui.render();
    return;
  }
  if (data === "\x7f" || data === "\b") {
    // Backspace
    inputBuffer = inputBuffer.slice(0, -1);
    renderInputPrompt();
    return;
  }
  // Printable character
  if (data.length === 1 && data.charCodeAt(0) >= 32) {
    inputBuffer += data;
    renderInputPrompt();
  }
}

// ===== Actions =====
async function openInBrowser() {
  const port = serverManager.getPort();
  if (!port) {
    tui.setStatus("Server not running", 2000);
    return;
  }
  const url = `http://localhost:${port}`;
  // Windows: use start command
  heca.exec_process({ command: `cmd /c start "" "${url}"`, cwd: "." });
  tui.setStatus(`Opened ${url} in browser`, 2000);
}

async function handleEnter() {
  if (tui.view === "projects") {
    const project = tui.getSelectedProject();
    if (!project) return;
    tui.currentProject = project;
    const todos = await api.getTodos(project.id);
    tui.switchToTasks(project, Array.isArray(todos) ? todos : []);
  } else if (tui.view === "tasks") {
    const todo = tui.getSelectedTodo();
    if (!todo) return;
    tui.currentTodo = todo;
    const logs = await api.getTodoLogs(todo.id);
    tui.switchToLogs(todo, Array.isArray(logs) ? logs : []);
  }
}

async function handleBack() {
  if (tui.view === "logs") {
    tui.view = "tasks";
    tui.cursor = 0;
    if (tui.currentProject) await loadTodos(tui.currentProject.id);
    tui.render();
  } else if (tui.view === "tasks") {
    tui.view = "projects";
    tui.cursor = 0;
    await loadProjects();
  }
}

async function handleStart() {
  if (!api) return;
  try {
    if (tui.view === "projects") {
      const project = tui.getSelectedProject();
      if (!project) return;
      await api.startProject(project.id);
      tui.setStatus("Starting all tasks...", 2000);
    } else if (tui.view === "tasks") {
      const todo = tui.getSelectedTodo();
      if (!todo) return;
      await api.startTodo(todo.id);
      tui.setStatus("Starting task...", 2000);
    }
  } catch (err) {
    tui.setStatus("Error: " + (err.message || err), 3000);
  }
}

async function handleStop() {
  if (!api || tui.view !== "tasks") return;
  try {
    const todo = tui.getSelectedTodo();
    if (!todo) return;
    await api.stopTodo(todo.id);
    tui.setStatus("Stopping task...", 2000);
  } catch (err) {
    tui.setStatus("Error: " + (err.message || err), 3000);
  }
}

async function handleNewProject() {
  startInput("Project name", async (name) => {
    if (!name.trim()) {
      tui.render();
      return;
    }
    try {
      await api.createProject({ name: name.trim() });
      tui.setStatus("Project created", 2000);
      await loadProjects();
    } catch (err) {
      tui.setStatus("Error: " + (err.message || err), 3000);
      tui.render();
    }
  });
}

async function handleAddTodo() {
  if (!tui.currentProject) return;
  startInput("Task description", async (content) => {
    if (!content.trim()) {
      tui.render();
      return;
    }
    try {
      await api.createTodo(tui.currentProject.id, { content: content.trim() });
      tui.setStatus("Task added", 2000);
      await loadTodos(tui.currentProject.id);
    } catch (err) {
      tui.setStatus("Error: " + (err.message || err), 3000);
      tui.render();
    }
  });
}

// ===== Keyboard input handler =====
process.stdin.on("data", (data) => {
  const str = typeof data === "string" ? data : data.toString();

  // Input prompt mode
  if (inputPromptActive) {
    handleInputKey(str);
    return;
  }

  // Global keys
  switch (str) {
    case "q":
    case "\x03": // Ctrl+C
      shutdown();
      return;
    case "o":
      openInBrowser();
      return;
    case "r":
      tui.setStatus("Restarting server...", 0);
      serverManager.stop();
      serverManager.start().catch(() => {});
      return;
  }

  // Navigation
  switch (str) {
    case "\x1b[A": // Up
    case "k":
      tui.moveCursorUp();
      return;
    case "\x1b[B": // Down
    case "j":
      tui.moveCursorDown();
      return;
    case "\r": // Enter
      handleEnter();
      return;
    case "b":
    case "\x1b": // Escape
      handleBack();
      return;
  }

  // View-specific keys
  switch (str) {
    case "s":
      handleStart();
      return;
    case "x":
      handleStop();
      return;
    case "n":
      if (tui.view === "projects") handleNewProject();
      return;
    case "a":
      if (tui.view === "tasks") handleAddTodo();
      return;
    case "f":
      if (tui.view === "logs") {
        tui.logScrollOffset = 0;
        tui.render();
      }
      return;
  }
});

// ===== Startup =====
async function startup() {
  heca.set_title({ title: "CLITrigger (starting...)" });
  tui.setStatus("Starting CLITrigger server...", 0);
  tui.render();

  try {
    await serverManager.start();
  } catch (err) {
    tui.setStatus(`Failed to start server: ${err.message}`, 0);
    tui.render();
    heca.notify({
      title: "CLITrigger",
      body: `Failed to start: ${err.message}. Is Node.js installed?`,
    });
  }

  // Periodic refresh (backup for missed WS events)
  refreshInterval = setInterval(() => {
    if (tui.view === "projects") loadProjects();
    else if (tui.view === "tasks" && tui.currentProject) loadTodos(tui.currentProject.id);
  }, 5000);
}

function shutdown() {
  if (refreshInterval) clearInterval(refreshInterval);
  if (api) api.disconnectWebSocket();
  serverManager.stop();
  tui.cleanup();
  heca.close();
}

// Start the plugin
startup();
