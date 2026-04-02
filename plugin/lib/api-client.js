// HTTP/WebSocket client for CLITrigger REST API
const http = require("http");

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.eventHandlers = {};
  }

  // Generic HTTP request
  request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { "Content-Type": "application/json" },
      };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  get(path) {
    return this.request("GET", path);
  }

  post(path, body) {
    return this.request("POST", path, body);
  }

  put(path, body) {
    return this.request("PUT", path, body);
  }

  del(path) {
    return this.request("DELETE", path);
  }

  // API shortcuts
  async getProjects() {
    return this.get("/api/projects");
  }

  async getProject(id) {
    return this.get(`/api/projects/${id}`);
  }

  async getTodos(projectId) {
    return this.get(`/api/projects/${projectId}/todos`);
  }

  async createTodo(projectId, data) {
    return this.post(`/api/projects/${projectId}/todos`, data);
  }

  async startProject(projectId) {
    return this.post(`/api/projects/${projectId}/start`);
  }

  async stopProject(projectId) {
    return this.post(`/api/projects/${projectId}/stop`);
  }

  async startTodo(todoId) {
    return this.post(`/api/todos/${todoId}/start`);
  }

  async stopTodo(todoId) {
    return this.post(`/api/todos/${todoId}/stop`);
  }

  async getTodoLogs(todoId) {
    return this.get(`/api/todos/${todoId}/logs`);
  }

  async createProject(data) {
    return this.post("/api/projects", data);
  }

  // WebSocket for real-time events
  connectWebSocket(onMessage) {
    const wsUrl = this.baseUrl.replace("http://", "ws://") + "/ws";
    try {
      // Use raw TCP for WebSocket handshake since we're in Deno/Node compat
      const url = new URL(wsUrl);
      const net = require("net");
      const crypto = require("crypto");
      const key = crypto.randomBytes(16).toString("base64");

      const socket = net.createConnection(
        { host: url.hostname, port: parseInt(url.port) },
        () => {
          socket.write(
            `GET /ws HTTP/1.1\r\n` +
            `Host: ${url.host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n\r\n`
          );
        }
      );

      let upgraded = false;
      let buffer = Buffer.alloc(0);

      socket.on("data", (data) => {
        if (!upgraded) {
          const str = data.toString();
          if (str.includes("\r\n\r\n")) {
            upgraded = true;
            const bodyStart = str.indexOf("\r\n\r\n") + 4;
            if (bodyStart < data.length) {
              buffer = Buffer.concat([buffer, data.slice(bodyStart)]);
            }
          }
          return;
        }

        buffer = Buffer.concat([buffer, data]);
        // Parse WebSocket frames
        while (buffer.length >= 2) {
          const secondByte = buffer[1] & 0x7f;
          let payloadLen = secondByte;
          let offset = 2;

          if (secondByte === 126) {
            if (buffer.length < 4) break;
            payloadLen = buffer.readUInt16BE(2);
            offset = 4;
          } else if (secondByte === 127) {
            if (buffer.length < 10) break;
            payloadLen = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }

          if (buffer.length < offset + payloadLen) break;

          const opcode = buffer[0] & 0x0f;
          const payload = buffer.slice(offset, offset + payloadLen);
          buffer = buffer.slice(offset + payloadLen);

          if (opcode === 0x01) {
            // Text frame
            try {
              const msg = JSON.parse(payload.toString("utf8"));
              onMessage(msg);
            } catch {}
          } else if (opcode === 0x09) {
            // Ping → send Pong
            const pong = Buffer.alloc(2);
            pong[0] = 0x8a; // fin + pong
            pong[1] = 0;
            socket.write(pong);
          } else if (opcode === 0x08) {
            // Close
            socket.end();
          }
        }
      });

      socket.on("error", () => {});
      socket.on("close", () => {
        this.ws = null;
        // Auto-reconnect after 3 seconds
        setTimeout(() => this.connectWebSocket(onMessage), 3000);
      });

      this.ws = socket;
    } catch {}
  }

  disconnectWebSocket() {
    if (this.ws) {
      try { this.ws.end(); } catch {}
      this.ws = null;
    }
  }
}

module.exports = { ApiClient };
