// Server lifecycle manager: spawn/kill/restart CLITrigger Node.js server
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const net = require("net");

const MAX_RESTARTS = 3;
const HEALTH_CHECK_INTERVAL = 500;
const HEALTH_CHECK_TIMEOUT = 15000;

class ServerManager {
  constructor(opts) {
    this.serverDir = opts.serverDir;
    this.dbPath = opts.dbPath;
    this.port = 0;
    this.proc = null;
    this.restartCount = 0;
    this.onReady = opts.onReady || (() => {});
    this.onError = opts.onError || (() => {});
    this.onExit = opts.onExit || (() => {});
    this.stopping = false;
  }

  async findFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.on("error", reject);
    });
  }

  async start() {
    this.stopping = false;
    this.port = await this.findFreePort();

    const serverEntry = path.join(this.serverDir, "server.js");
    const env = Object.assign({}, process.env, {
      PORT: String(this.port),
      DB_PATH: this.dbPath,
      HEADLESS: "true",
      DISABLE_AUTH: "true",
      NODE_ENV: "production",
    });

    this.proc = spawn("node", [serverEntry], {
      cwd: this.serverDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout.on("data", () => {});
    this.proc.stderr.on("data", () => {});

    this.proc.on("exit", (code) => {
      if (this.stopping) return;
      if (this.restartCount < MAX_RESTARTS) {
        this.restartCount++;
        this.start().catch(this.onError);
      } else {
        this.onExit(code);
      }
    });

    await this.waitForHealth();
    this.restartCount = 0;
    this.onReady(this.port);
  }

  waitForHealth() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (Date.now() - start > HEALTH_CHECK_TIMEOUT) {
          return reject(new Error("Server health check timeout"));
        }
        const req = http.get(
          `http://127.0.0.1:${this.port}/api/health`,
          (res) => {
            if (res.statusCode === 200) return resolve();
            setTimeout(check, HEALTH_CHECK_INTERVAL);
          }
        );
        req.on("error", () => setTimeout(check, HEALTH_CHECK_INTERVAL));
        req.setTimeout(2000, () => {
          req.destroy();
          setTimeout(check, HEALTH_CHECK_INTERVAL);
        });
      };
      check();
    });
  }

  stop() {
    this.stopping = true;
    if (this.proc) {
      this.proc.kill("SIGTERM");
      // Force kill after 3 seconds
      const forceTimeout = setTimeout(() => {
        try { this.proc.kill("SIGKILL"); } catch {}
      }, 3000);
      this.proc.on("exit", () => clearTimeout(forceTimeout));
      this.proc = null;
    }
  }

  getPort() {
    return this.port;
  }

  getBaseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }
}

module.exports = { ServerManager };
