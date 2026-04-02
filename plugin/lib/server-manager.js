// Server manager — connects to an already-running CLITrigger server
// User must start the server separately (npm run start)
const path = require("path");

const HEALTH_CHECK_INTERVAL = 1000;
const HEALTH_CHECK_TIMEOUT = 10000;
const DEFAULT_PORT = 3000;

const heca = globalThis.hecaton;

class ServerManager {
  constructor(opts) {
    this.port = opts.port || DEFAULT_PORT;
    this.onReady = opts.onReady || (() => {});
    this.onError = opts.onError || (() => {});
    this.onExit = opts.onExit || (() => {});
    this.stopping = false;
  }

  async start() {
    this.stopping = false;

    try {
      await this.waitForHealth();
      this.onReady(this.port);
    } catch (err) {
      this.onError(err);
    }
  }

  async waitForHealth() {
    const start = Date.now();
    while (Date.now() - start < HEALTH_CHECK_TIMEOUT) {
      try {
        const resp = await heca.exec_process({
          program: "curl",
          args: ["-s", `http://127.0.0.1:${this.port}/api/health`],
          timeout: 3000,
        });
        if (resp && resp.ok && resp.stdout && resp.stdout.includes("ok")) {
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL));
    }
    throw new Error("Server not found on port " + this.port + ". Run 'npm run start' in CLITrigger first.");
  }

  stop() {
    this.stopping = true;
  }

  getPort() {
    return this.port;
  }

  getBaseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }
}

module.exports = { ServerManager };
