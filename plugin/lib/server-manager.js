// Server manager — auto-launches CLITrigger Node.js server as sidecar
// Tier 1: Deno.Command (stdin pipe for graceful shutdown)
// Tier 2: PowerShell Start-Process fallback (PID tracking + taskkill)
const path = require("path");

const HEALTH_CHECK_INTERVAL = 1000;
const HEALTH_CHECK_TIMEOUT = 15000;
const DEFAULT_PORT = 3000;

const heca = globalThis.hecaton;

class ServerManager {
  constructor(opts) {
    this.port = opts.port || DEFAULT_PORT;
    this.pluginDir = opts.pluginDir || __dirname;
    this.onReady = opts.onReady || (() => {});
    this.onError = opts.onError || (() => {});
    this.onExit = opts.onExit || (() => {});
    this.stopping = false;
    this.spawned = false;
    this.serverProcess = null; // Deno.Command child
    this.serverPid = null; // PID for fallback cleanup
  }

  async start() {
    this.stopping = false;

    // Check if server is already running
    const existing = await this._checkExistingServer();
    if (existing) {
      this.spawned = false;
      this.onReady(this.port);
      return;
    }

    // Spawn server
    try {
      await this._spawnServer();
    } catch (err) {
      this.onError(new Error("Failed to spawn server: " + err.message));
      return;
    }

    // Wait for health
    try {
      await this._waitForHealth();
      this.onReady(this.port);
    } catch (err) {
      this.onError(err);
    }
  }

  stop() {
    this.stopping = true;
    if (!this.spawned) return;

    // Tier 1: Deno.Command — close stdin for graceful shutdown, then kill as backup
    if (this.serverProcess) {
      try {
        const writer = this.serverProcess.stdin.getWriter();
        writer.close().catch(() => {});
      } catch {}
      const proc = this.serverProcess;
      setTimeout(() => {
        try { proc.kill(); } catch {}
      }, 3000);
      this.serverProcess = null;
    }
    // Tier 2: taskkill by PID
    else if (this.serverPid) {
      try {
        heca.exec_process({
          program: "taskkill",
          args: ["/PID", String(this.serverPid), "/T", "/F"],
          timeout: 5000,
        });
      } catch {}
      this.serverPid = null;
    }

    this.spawned = false;
  }

  async _checkExistingServer() {
    try {
      const resp = await heca.exec_process({
        program: "curl",
        args: ["-s", "-m", "2", `http://127.0.0.1:${this.port}/api/health`],
        timeout: 3000,
      });
      return resp && resp.ok && resp.stdout && resp.stdout.includes("ok");
    } catch {
      return false;
    }
  }

  async _spawnServer() {
    const serverDir = path.join(this.pluginDir, "server");
    const serverScript = path.join(serverDir, "server.mjs");
    const env = {
      HEADLESS: "true",
      DISABLE_AUTH: "true",
      PORT: String(this.port),
    };

    // Tier 1: Deno.Command
    try {
      await this._spawnViaDeno(serverScript, serverDir, env);
      return;
    } catch {}

    // Tier 2: PowerShell fallback
    await this._spawnViaCmd(serverScript, serverDir, env);
  }

  async _spawnViaDeno(serverScript, serverDir, env) {
    if (typeof Deno === "undefined" || !Deno.Command) {
      throw new Error("Deno.Command not available");
    }

    const cmd = new Deno.Command("node", {
      args: [serverScript],
      cwd: serverDir,
      env: { ...env, PATH: Deno.env.get("PATH") || "" },
      stdin: "piped",
      stdout: "null",
      stderr: "null",
    });

    this.serverProcess = cmd.spawn();
    this.serverPid = this.serverProcess.pid;
    this.spawned = true;
  }

  async _spawnViaCmd(serverScript, serverDir, env) {
    const envSetup = Object.entries(env)
      .map(([k, v]) => `$env:${k}='${v}'`)
      .join("; ");

    const psCmd =
      `${envSetup}; ` +
      `$p = Start-Process -FilePath 'node' -ArgumentList '${serverScript.replace(/'/g, "''")}' ` +
      `-WorkingDirectory '${serverDir.replace(/'/g, "''")}' ` +
      `-PassThru -WindowStyle Hidden; ` +
      `$p.Id`;

    const resp = await heca.exec_process({
      program: "powershell",
      args: ["-NoProfile", "-Command", psCmd],
      timeout: 10000,
    });

    if (resp && resp.ok && resp.stdout) {
      const pid = parseInt(resp.stdout.trim(), 10);
      if (!isNaN(pid)) {
        this.serverPid = pid;
        this.spawned = true;
        return;
      }
    }
    throw new Error("Failed to start server via PowerShell");
  }

  async _waitForHealth() {
    const start = Date.now();
    while (Date.now() - start < HEALTH_CHECK_TIMEOUT) {
      if (this.stopping) throw new Error("Stopped");
      try {
        const resp = await heca.exec_process({
          program: "curl",
          args: ["-s", "-m", "2", `http://127.0.0.1:${this.port}/api/health`],
          timeout: 3000,
        });
        if (resp && resp.ok && resp.stdout && resp.stdout.includes("ok")) {
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL));
    }
    throw new Error(
      `Server failed to start on port ${this.port}. Check if Node.js is installed or port is in use.`
    );
  }

  getPort() {
    return this.port;
  }

  getBaseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }
}

module.exports = { ServerManager };
