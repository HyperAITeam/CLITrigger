// HTTP client for CLITrigger REST API — uses only hecaton.http_get/exec_process
// No WebSocket (Deno compat issues) — uses polling instead

const heca = globalThis.hecaton;

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async request(method, apiPath, body) {
    const url = this.baseUrl + apiPath;

    // All requests via curl (hecaton.http_get blocks localhost)
    // For POST with body: write JSON to temp file, then curl @file
    try {
      let resp;
      if (body) {
        const tmpPath = (process.env.TEMP || process.env.TMP || "C:/Users/user/AppData/Local/Temp") + "/clitrigger_body.json";
        await heca.fs_write_file({ path: tmpPath.replace(/\\/g, "/"), text: JSON.stringify(body) });
        resp = await heca.exec_process({
          program: "curl",
          args: ["-s", "-X", method, url, "-H", "Content-Type: application/json", "-d", "@" + tmpPath.replace(/\\/g, "/")],
          timeout: 10000,
        });
      } else {
        resp = await heca.exec_process({
          program: "curl",
          args: ["-s", "-X", method, url],
          timeout: 10000,
        });
      }
      if (resp && resp.ok && resp.stdout) {
        try { return JSON.parse(resp.stdout); } catch { return resp.stdout; }
      }
      return null;
    } catch (e) {
      throw new Error("Request failed: " + (e.message || e));
    }
  }

  get(apiPath) { return this.request("GET", apiPath); }
  post(apiPath, body) { return this.request("POST", apiPath, body); }
  put(apiPath, body) { return this.request("PUT", apiPath, body); }
  del(apiPath) { return this.request("DELETE", apiPath); }

  // API shortcuts
  getProjects() { return this.get("/api/projects"); }
  getProject(id) { return this.get("/api/projects/" + id); }
  getTodos(projectId) { return this.get("/api/projects/" + projectId + "/todos"); }
  createTodo(projectId, data) { return this.post("/api/projects/" + projectId + "/todos", data); }
  startProject(projectId) { return this.post("/api/projects/" + projectId + "/start"); }
  stopProject(projectId) { return this.post("/api/projects/" + projectId + "/stop"); }
  startTodo(todoId) { return this.post("/api/todos/" + todoId + "/start"); }
  stopTodo(todoId) { return this.post("/api/todos/" + todoId + "/stop"); }
  getTodoLogs(todoId) { return this.get("/api/todos/" + todoId + "/logs"); }
  createProject(data) { return this.post("/api/projects", data); }

  // No WebSocket in Deno compat — polling is used in main.js instead
  connectWebSocket() {}
  disconnectWebSocket() {}
}

module.exports = { ApiClient };
