import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getSetting } from '../db/app-settings.js';
import { matchesMcpToken } from '../middleware/auth.js';

// CLITrigger's MCP server. Tools are thin wrappers over the app's own REST API,
// called back over loopback — so they reuse the stable HTTP contract (and its
// validation) rather than coupling to internal service signatures.

interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

async function callApi(
  baseUrl: string,
  token: string,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function toTextResult(r: ApiResult) {
  const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
  return { content: [{ type: 'text' as const, text }], isError: !r.ok };
}

async function run(fn: () => Promise<ApiResult>) {
  try {
    return toTextResult(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `CLITrigger 서버에 연결할 수 없습니다: ${message}` }],
      isError: true,
    };
  }
}

function buildServer(baseUrl: string): McpServer {
  const token = getSetting('mcp.token') || '';
  // Version of the MCP tool interface, independent of the app version.
  const server = new McpServer({ name: 'clitrigger', version: '1.0.0' });

  server.registerTool(
    'list_projects',
    { description: 'CLITrigger에 등록된 모든 프로젝트 목록을 반환합니다.' },
    () => run(() => callApi(baseUrl, token, 'GET', '/api/projects')),
  );

  server.registerTool(
    'create_project',
    {
      description: '새 프로젝트를 등록합니다. path는 로컬 절대 경로여야 합니다.',
      inputSchema: {
        name: z.string(),
        path: z.string(),
        default_branch: z.string().optional(),
      },
    },
    (args) => run(() => callApi(baseUrl, token, 'POST', '/api/projects', args)),
  );

  server.registerTool(
    'create_todo',
    {
      description: '지정한 프로젝트에 할일(TODO)을 생성합니다.',
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.number().optional(),
      },
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/todos`, body)),
  );

  server.registerTool(
    'start_todo',
    {
      description: '할일 실행을 시작합니다. mode 기본값은 headless.',
      inputSchema: {
        todo_id: z.string(),
        mode: z.enum(['headless', 'interactive', 'verbose']).optional(),
      },
    },
    ({ todo_id, mode }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/todos/${todo_id}/start`, { mode: mode ?? 'headless' })),
  );

  server.registerTool(
    'stop_todo',
    {
      description: '실행 중인 할일을 중지합니다.',
      inputSchema: { todo_id: z.string() },
    },
    ({ todo_id }) => run(() => callApi(baseUrl, token, 'POST', `/api/todos/${todo_id}/stop`)),
  );

  server.registerTool(
    'get_project_status',
    {
      description: '프로젝트의 실행 상태 요약을 반환합니다.',
      inputSchema: { project_id: z.string() },
    },
    ({ project_id }) => run(() => callApi(baseUrl, token, 'GET', `/api/projects/${project_id}/status`)),
  );

  server.registerTool(
    'get_todo_logs',
    {
      description: '할일의 실행 로그를 반환합니다.',
      inputSchema: { todo_id: z.string() },
    },
    ({ todo_id }) => run(() => callApi(baseUrl, token, 'GET', `/api/todos/${todo_id}/logs`)),
  );

  // ── Planner ──────────────────────────────────────────────────────────────
  server.registerTool(
    'create_planner_item',
    {
      description: '지정한 프로젝트의 플래너에 항목을 생성합니다.',
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.number().optional(),
        due_date: z.string().optional(),
      },
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/planner`, body)),
  );

  server.registerTool(
    'delete_planner_item',
    {
      description: '플래너 항목을 삭제합니다.',
      inputSchema: { item_id: z.string() },
    },
    ({ item_id }) => run(() => callApi(baseUrl, token, 'DELETE', `/api/planner/${item_id}`)),
  );

  // ── Schedules ────────────────────────────────────────────────────────────
  server.registerTool(
    'create_schedule',
    {
      description:
        '지정한 프로젝트에 스케줄을 생성합니다. recurring은 cron_expression, once는 run_at(ISO)이 필요합니다.',
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        schedule_type: z.enum(['once', 'recurring']).optional(),
        cron_expression: z.string().optional(),
        run_at: z.string().optional(),
        cli_tool: z.string().optional(),
      },
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/schedules`, body)),
  );

  server.registerTool(
    'delete_schedule',
    {
      description: '스케줄을 삭제합니다.',
      inputSchema: { schedule_id: z.string() },
    },
    ({ schedule_id }) => run(() => callApi(baseUrl, token, 'DELETE', `/api/schedules/${schedule_id}`)),
  );

  // ── Sessions ─────────────────────────────────────────────────────────────
  server.registerTool(
    'create_session',
    {
      description: '지정한 프로젝트에 인터랙티브 터미널 세션을 생성합니다. title 생략 시 자동 생성됩니다.',
      inputSchema: {
        project_id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        cli_tool: z.string().optional(),
        use_worktree: z.boolean().optional(),
      },
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/sessions`, body)),
  );

  server.registerTool(
    'delete_session',
    {
      description: '세션을 삭제합니다.',
      inputSchema: { session_id: z.string() },
    },
    ({ session_id }) => run(() => callApi(baseUrl, token, 'DELETE', `/api/sessions/${session_id}`)),
  );

  // ── Wiki (내부적으로는 memory node) ────────────────────────────────────────
  server.registerTool(
    'create_wiki_node',
    {
      description: '지정한 프로젝트의 위키(Wiki)에 노드를 생성합니다. title은 프로젝트 내에서 고유해야 합니다.',
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        pinned: z.boolean().optional(),
      },
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/memory/nodes`, body)),
  );

  server.registerTool(
    'delete_wiki_node',
    {
      description: '위키(Wiki) 노드를 삭제합니다.',
      inputSchema: { node_id: z.string() },
    },
    ({ node_id }) => run(() => callApi(baseUrl, token, 'DELETE', `/api/memory/nodes/${node_id}`)),
  );

  return server;
}

const mcpAuth: RequestHandler = (req, res, next) => {
  if (matchesMcpToken(req)) return next();
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized' },
    id: null,
  });
};

export function mountMcp(app: Express): void {
  app.post('/mcp', mcpAuth, async (req: Request, res: Response) => {
    // Loopback target = the actual bound port (server may have retried past
    // EADDRINUSE), taken from the incoming connection.
    const baseUrl = `http://127.0.0.1:${req.socket.localPort}`;
    const server = buildServer(baseUrl);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless server: no SSE stream (GET) or session teardown (DELETE).
  const methodNotAllowed: RequestHandler = (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
