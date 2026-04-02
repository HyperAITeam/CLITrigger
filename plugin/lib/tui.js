// Terminal UI renderer using ANSI escape sequences
// Renders project list, task list, and log views in Hecaton terminal cell

const ESC = "\x1b";
const CSI = ESC + "[";

// Colors
const RESET = CSI + "0m";
const BOLD = CSI + "1m";
const DIM = CSI + "2m";
const GREEN = CSI + "32m";
const YELLOW = CSI + "33m";
const RED = CSI + "31m";
const CYAN = CSI + "36m";
const WHITE = CSI + "37m";
const BG_BLUE = CSI + "44m";
const BG_DEFAULT = CSI + "49m";

// Screen control
const CLEAR = CSI + "2J";
const HOME = CSI + "H";
const HIDE_CURSOR = CSI + "?25l";
const SHOW_CURSOR = CSI + "?25h";

function moveTo(row, col) {
  return CSI + row + ";" + col + "H";
}

// Status icons
const STATUS_ICON = {
  pending: DIM + "\u25CB" + RESET,     // ○
  running: YELLOW + "\u25CF" + RESET,   // ●
  done: GREEN + "\u2713" + RESET,       // ✓
  failed: RED + "\u2717" + RESET,       // ✗
  stopped: RED + "\u25A0" + RESET,      // ■
};

function getStatusIcon(status) {
  return STATUS_ICON[status] || DIM + "?" + RESET;
}

class TUI {
  constructor() {
    this.cols = parseInt(process.env.HECA_COLS || "80", 10) || 80;
    this.rows = parseInt(process.env.HECA_ROWS || "24", 10) || 24;
    this.view = "projects"; // projects | tasks | logs
    this.cursor = 0;
    this.projects = [];
    this.todos = [];
    this.logs = [];
    this.currentProject = null;
    this.currentTodo = null;
    this.logScrollOffset = 0;
    this.statusMessage = "";
    this.statusTimeout = null;
  }

  write(str) {
    process.stdout.write(str);
  }

  setStatus(msg, duration) {
    this.statusMessage = msg;
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    if (duration) {
      this.statusTimeout = setTimeout(() => {
        this.statusMessage = "";
        this.render();
      }, duration);
    }
  }

  render() {
    this.write(HIDE_CURSOR + CLEAR + HOME);

    switch (this.view) {
      case "projects":
        this.renderProjects();
        break;
      case "tasks":
        this.renderTasks();
        break;
      case "logs":
        this.renderLogs();
        break;
    }

    this.renderStatusBar();
  }

  renderHeader(title, hints) {
    const hintStr = hints.map((h) => DIM + "[" + WHITE + h[0] + DIM + "] " + h[1] + RESET).join("  ");
    this.write(moveTo(1, 1));
    this.write(BOLD + CYAN + " " + title + RESET);
    this.write(moveTo(1, Math.max(1, this.cols - this.stripAnsi(hintStr).length - 1)));
    this.write(hintStr);
    this.write(moveTo(2, 1));
    this.write(DIM + "\u2500".repeat(this.cols) + RESET);
  }

  renderProjects() {
    this.renderHeader("CLITrigger", [
      ["o", "Web"],
      ["n", "New"],
      ["q", "Quit"],
    ]);

    if (this.projects.length === 0) {
      this.write(moveTo(4, 3) + DIM + "No projects. Press [n] to create one." + RESET);
      return;
    }

    const maxVisible = this.rows - 5;
    const start = Math.max(0, this.cursor - maxVisible + 1);
    const visible = this.projects.slice(start, start + maxVisible);

    visible.forEach((p, i) => {
      const idx = start + i;
      const row = 4 + i;
      const selected = idx === this.cursor;
      const prefix = selected ? BOLD + CYAN + " \u25B6 " + RESET : "   ";

      // Count task statuses
      const stats = this.getProjectStats(p);
      const statsStr =
        GREEN + stats.done + RESET + "/" +
        WHITE + stats.total + RESET +
        (stats.running > 0 ? "  " + YELLOW + stats.running + " running" + RESET : "") +
        (stats.failed > 0 ? "  " + RED + stats.failed + " failed" + RESET : "");

      this.write(moveTo(row, 1));
      this.write(prefix + (selected ? BOLD : "") + this.truncate(p.name, 30) + RESET);
      this.write(moveTo(row, 36) + statsStr);
    });

    this.write(moveTo(this.rows - 2, 1));
    this.write(DIM + "\u2500".repeat(this.cols) + RESET);
    this.write(moveTo(this.rows - 1, 1));
    this.write(
      DIM + " [" + WHITE + "\u2191\u2193" + DIM + "] Navigate  " +
      "[" + WHITE + "Enter" + DIM + "] Open  " +
      "[" + WHITE + "s" + DIM + "] Start All  " +
      "[" + WHITE + "d" + DIM + "] Delete" + RESET
    );
  }

  renderTasks() {
    const name = this.currentProject ? this.currentProject.name : "Tasks";
    this.renderHeader(name, [
      ["b", "Back"],
      ["o", "Web"],
      ["q", "Quit"],
    ]);

    if (this.todos.length === 0) {
      this.write(moveTo(4, 3) + DIM + "No tasks. Press [a] to add one." + RESET);
      return;
    }

    const maxVisible = this.rows - 5;
    const start = Math.max(0, this.cursor - maxVisible + 1);
    const visible = this.todos.slice(start, start + maxVisible);

    visible.forEach((t, i) => {
      const idx = start + i;
      const row = 4 + i;
      const selected = idx === this.cursor;
      const prefix = selected ? BOLD + CYAN + " \u25B6 " + RESET : "   ";
      const icon = getStatusIcon(t.status);
      const statusLabel =
        t.status === "running"
          ? YELLOW + " running..." + RESET
          : t.status === "failed"
          ? RED + " failed" + RESET
          : t.status === "done"
          ? GREEN + " done" + RESET
          : DIM + " pending" + RESET;

      this.write(moveTo(row, 1));
      this.write(prefix + icon + " " + (selected ? BOLD : "") + this.truncate(t.content || t.title, 40) + RESET);
      this.write(moveTo(row, 50) + statusLabel);
    });

    this.write(moveTo(this.rows - 2, 1));
    this.write(DIM + "\u2500".repeat(this.cols) + RESET);
    this.write(moveTo(this.rows - 1, 1));
    this.write(
      DIM + " [" + WHITE + "\u2191\u2193" + DIM + "] Navigate  " +
      "[" + WHITE + "Enter" + DIM + "] Logs  " +
      "[" + WHITE + "s" + DIM + "] Start  " +
      "[" + WHITE + "x" + DIM + "] Stop  " +
      "[" + WHITE + "a" + DIM + "] Add" + RESET
    );
  }

  renderLogs() {
    const title = this.currentTodo
      ? this.truncate(this.currentTodo.content || this.currentTodo.title, 40)
      : "Logs";
    this.renderHeader("Logs: " + title, [
      ["b", "Back"],
      ["q", "Quit"],
    ]);

    const maxVisible = this.rows - 5;
    const totalLogs = this.logs.length;
    const start = Math.max(0, totalLogs - maxVisible - this.logScrollOffset);
    const visible = this.logs.slice(start, start + maxVisible);

    visible.forEach((log, i) => {
      const row = 4 + i;
      this.write(moveTo(row, 1));
      const color =
        log.log_type === "error" ? RED :
        log.log_type === "commit" ? GREEN :
        RESET;
      const text = (log.content || "").replace(/\n/g, " ");
      this.write(" " + color + this.truncate(text, this.cols - 2) + RESET);
    });

    this.write(moveTo(this.rows - 2, 1));
    this.write(DIM + "\u2500".repeat(this.cols) + RESET);
    this.write(moveTo(this.rows - 1, 1));
    this.write(
      DIM + " [" + WHITE + "\u2191\u2193" + DIM + "] Scroll  " +
      "[" + WHITE + "b" + DIM + "] Back  " +
      "[" + WHITE + "f" + DIM + "] Follow" + RESET
    );
  }

  renderStatusBar() {
    if (!this.statusMessage) return;
    this.write(moveTo(this.rows, 1));
    this.write(BG_BLUE + WHITE + " " + this.statusMessage + " " + RESET + BG_DEFAULT);
  }

  // Navigation
  moveCursorUp() {
    if (this.view === "logs") {
      this.logScrollOffset = Math.min(this.logScrollOffset + 1, Math.max(0, this.logs.length - (this.rows - 5)));
    } else {
      this.cursor = Math.max(0, this.cursor - 1);
    }
    this.render();
  }

  moveCursorDown() {
    if (this.view === "logs") {
      this.logScrollOffset = Math.max(0, this.logScrollOffset - 1);
    } else {
      const max = this.view === "projects" ? this.projects.length - 1 : this.todos.length - 1;
      this.cursor = Math.min(max, this.cursor + 1);
    }
    this.render();
  }

  getSelectedProject() {
    return this.projects[this.cursor] || null;
  }

  getSelectedTodo() {
    return this.todos[this.cursor] || null;
  }

  switchToTasks(project, todos) {
    this.currentProject = project;
    this.todos = todos;
    this.view = "tasks";
    this.cursor = 0;
    this.render();
  }

  switchToProjects(projects) {
    this.projects = projects;
    this.view = "projects";
    this.cursor = Math.min(this.cursor, Math.max(0, projects.length - 1));
    this.render();
  }

  switchToLogs(todo, logs) {
    this.currentTodo = todo;
    this.logs = logs;
    this.view = "logs";
    this.logScrollOffset = 0;
    this.render();
  }

  updateProjects(projects) {
    this.projects = projects;
    if (this.view === "projects") this.render();
  }

  updateTodos(todos) {
    this.todos = todos;
    if (this.view === "tasks") this.render();
  }

  appendLog(log) {
    this.logs.push(log);
    if (this.view === "logs" && this.logScrollOffset === 0) this.render();
  }

  // Helpers
  getProjectStats(project) {
    // If project has cached stats, use them
    return {
      total: project.total_count || 0,
      done: project.done_count || 0,
      running: project.running_count || 0,
      failed: project.failed_count || 0,
    };
  }

  truncate(str, maxLen) {
    if (!str) return "";
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 1) + "\u2026";
  }

  stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }

  cleanup() {
    this.write(SHOW_CURSOR + CLEAR + HOME);
  }
}

module.exports = { TUI };
