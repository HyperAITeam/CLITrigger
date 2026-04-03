// HTTP client for CLITrigger REST API — uses curl for all requests
// No WebSocket (Deno compat issues) — uses polling instead

const heca = globalThis.hecaton;

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async request(method, apiPath, body) {
    const url = this.baseUrl + apiPath;

    try {
      let resp;
      if (body) {
        // Use curl with --data-raw to avoid shell escaping issues
        const jsonStr = JSON.stringify(body);
        resp = await heca.exec_process({
          program: "curl",
          args: ["-s", "-X", method, url,
            "-H", "Content-Type: application/json",
            "--data-raw", jsonStr],
          timeout: 10000,
        });
      } else if (method !== "GET") {
        resp = await heca.exec_process({
          program: "curl",
          args: ["-s", "-X", method, url,
            "-H", "Content-Type: application/json",
            "--data-raw", "{}"],
          timeout: 10000,
        });
      } else {
        resp = await heca.exec_process({
          program: "curl",
          args: ["-s", url],
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
