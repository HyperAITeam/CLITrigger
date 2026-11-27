process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setSetting } from '../db/app-settings.js';
import { closeDatabase } from '../db/connection.js';
import { mountMcp, listMcpCatalog } from './index.js';

const TOKEN = 'test-mcp-token-abc';
let server: Server;
let mcpUrl: URL;
let lastCreatedSessionBody: unknown;
const waitCalls: string[] = [];

beforeAll(async () => {
  setSetting('mcp.token', TOKEN);
  const app = express();
  app.use(express.json());
  // Stub the API the tools call back into over loopback.
  app.get('/api/projects', (_req, res) => {
    res.json([{ id: 'p1', name: 'demo' }]);
  });
  app.post('/api/sessions/:id/input', (req, res) => {
    res.json({ id: req.params.id, body: req.body });
  });
  app.get('/api/sessions/:id', (req, res) => {
    res.json({ id: req.params.id, project_id: 'p1', cli_tool: req.params.id === 'shell1' ? 'raw-shell' : 'claude' });
  });
  app.post('/api/projects/:id/sessions', (req, res) => {
    lastCreatedSessionBody = req.body;
    if (req.body.parent_session_id === 'missing') {
      res.status(400).json({ error: 'Invalid parent_session_id' });
      return;
    }
    res.status(201).json({ id: 'child1', body: req.body });
  });
  app.post('/api/sessions/:id/start', (req, res) => {
    res.json({ id: req.params.id, body: req.body });
  });
  app.post('/api/projects/:id/todos', (req, res) => {
    res.json({ id: req.params.id, body: req.body });
  });
  // 's-slow' matches on the second wait call; 's-never' never matches.
  app.get('/api/sessions/:id/wait', (req, res) => {
    waitCalls.push(req.params.id);
    const calls = waitCalls.filter((id) => id === req.params.id).length;
    const matched = req.params.id === 's-slow' && calls >= 2;
    setTimeout(() => res.json({ matched, status: 'running', agent_state: matched ? 'blocked' : 'working' }), 20);
  });
  app.get('/api/sessions/:id/output', (req, res) => {
    res.json({ id: req.params.id, query: req.query });
  });
  app.get('/api/projects/:id', (req, res) => {
    res.json({ id: req.params.id, loop_defaults: JSON.stringify({ maxRounds: 3, check: 'npm test' }) });
  });
  app.put('/api/projects/:id', (req, res) => {
    res.json({ id: req.params.id, body: req.body });
  });
  app.put('/api/projects/:id/vault/tags/file', (req, res) => {
    res.json({ id: req.params.id, body: req.body });
  });
  mountMcp(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
});

function makeClient(token: string) {
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  // Pinned to the 2026-07-28 revision Claude Code speaks; the 2025 handshake
  // has its own test below.
  const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  return { client, transport };
}

describe('MCP endpoint', () => {
  it('rejects a bad bearer token', async () => {
    const { client, transport } = makeClient('wrong');
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it('lists all registered tools', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'create_planner_item',
      'create_project',
      'create_schedule',
      'create_session',
      'create_todo',
      'delete_planner_item',
      'delete_schedule',
      'delete_session',
      'get_project_status',
      'get_session_state',
      'get_todo_logs',
      'list_projects',
      'list_todos',
      'list_vault_tags',
      'read_session_output',
      'send_session_input',
      'set_vault_file_tags',
      'set_vault_tag_color',
      'spawn_session',
      'start_session',
      'start_todo',
      'stop_session',
      'stop_todo',
      'update_project_settings',
      'wait_session_state',
    ]);
    await client.close();
  });

  it('serves each prompt with its tools and optional argument', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['delegate', 'handoff', 'remember', 'status']);
    const cases: { name: string; arguments: Record<string, string>; expected: string[] }[] = [
      { name: 'handoff', arguments: { instruction: '테스트만 돌리기' }, expected: ['list_projects', 'create_session', '테스트만 돌리기'] },
      { name: 'delegate', arguments: { scope: 'UI만' }, expected: ['list_projects', 'create_todo', 'use_worktree=false', 'UI만'] },
      { name: 'remember', arguments: { topic: '포트 함정' }, expected: ['list_projects', '.clitrigger/wiki/', 'frontmatter', '포트 함정'] },
      { name: 'status', arguments: {}, expected: ['list_projects', 'list_todos', 'get_todo_logs'] },
    ];
    for (const { name, arguments: args, expected } of cases) {
      const { messages } = await client.getPrompt({ name, arguments: args });
      const text = (messages[0].content as { type: string; text: string }).text;
      for (const fragment of expected) expect(text, `${name} → ${fragment}`).toContain(fragment);
    }
    await client.close();
  });

  it('lists the catalog for the settings UI in-process', async () => {
    const catalog = await listMcpCatalog();
    expect(catalog.tools).toHaveLength(25);
    expect(catalog.tools.find((tool) => tool.name === 'list_projects')?.description).toBeTruthy();
    const handoff = catalog.prompts.find((prompt) => prompt.name === 'handoff');
    expect(handoff?.title).toBe('새 세션으로 넘기기');
    expect(handoff?.arguments.map((argument) => argument.name)).toEqual(['instruction']);
  });

  it('send_session_input refuses raw shell sessions', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const result = await client.callTool({
      name: 'send_session_input',
      arguments: { session_id: 'shell1', text: 'calc', submit: true },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('not allowed on raw shell sessions');
    await client.close();
  });

  it('send_session_input forwards text/submit to the input route', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const result = await client.callTool({
      name: 'send_session_input',
      arguments: { session_id: 's1', text: 'hi', submit: true },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ id: 's1', body: { text: 'hi', submit: true } });
    await client.close();
  });

  it('spawn_session creates the child with the prompt as description, then starts it with autoSubmit', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const result = await client.callTool({
      name: 'spawn_session',
      arguments: { project_id: 'p1', prompt: 'do it', parent_session_id: 'lead1', cli_tool: 'codex' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ id: 'child1', body: { autoSubmit: true } });
    expect(lastCreatedSessionBody).toEqual({ description: 'do it', parent_session_id: 'lead1', cli_tool: 'codex' });

    const failed = await client.callTool({
      name: 'spawn_session',
      arguments: { project_id: 'p1', prompt: 'do it', parent_session_id: 'missing' },
    });
    expect(failed.isError).toBe(true);
    expect((failed.content as Array<{ type: string; text: string }>)[0].text).toContain('Invalid parent_session_id');
    await client.close();
  });

  it('create_todo maps use_worktree to the 0/1 the todos route expects', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const bodyFor = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'create_todo', arguments: { project_id: 'p1', title: 't', ...args } });
      return JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text).body;
    };
    expect((await bodyFor({ use_worktree: false })).use_worktree).toBe(0);
    expect((await bodyFor({ use_worktree: true })).use_worktree).toBe(1);
    expect(await bodyFor({})).not.toHaveProperty('use_worktree');
    const withModel = await bodyFor({ cli_tool: 'claude', model: 'opus' });
    expect(withModel).toMatchObject({ cli_tool: 'claude', cli_model: 'opus' });
    expect(withModel).not.toHaveProperty('model');
    await client.close();
  });

  it('update_project_settings maps flags to 0/1 and merges loop_defaults into the stored rules', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const bodyFor = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'update_project_settings', arguments: { project_id: 'p1', ...args } });
      return JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text).body;
    };
    expect(await bodyFor({ default_max_turns: 50, use_worktree: false })).toEqual({ default_max_turns: 50, use_worktree: 0 });
    const merged = await bodyFor({ loop_defaults: { max_rounds: 8 } });
    expect(JSON.parse(merged.loop_defaults)).toEqual({ maxRounds: 8, check: 'npm test' });
    expect(await bodyFor({ loop_defaults: null })).toEqual({ loop_defaults: null });
    const outOfRange = await client.callTool({ name: 'update_project_settings', arguments: { project_id: 'p1', default_max_turns: 1000 } });
    expect(outOfRange.isError).toBe(true);
    await client.close();
  });

  it('set_vault_file_tags normalizes Windows-style paths to the vault form', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const result = await client.callTool({
      name: 'set_vault_file_tags',
      arguments: { project_id: 'p1', path: '.\\.clitrigger\\docs\\a.html', tags: ['GPU'] },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ id: 'p1', body: { path: '.clitrigger/docs/a.html', tags: ['GPU'] } });
    await client.close();
  });

  it('read_session_output maps tail_bytes/strip_ansi to query params', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const result = await client.callTool({
      name: 'read_session_output',
      arguments: { session_id: 's1', tail_bytes: 100, strip_ansi: false },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ id: 's1', query: { tail: '100', strip: '0' } });
    await client.close();
  });

  // Codex and Antigravity still speak the 2025 protocol: initialize, then
  // plain JSON-RPC POSTs with no per-request _meta envelope.
  it('serves 2025-era clients through the initialize handshake', async () => {
    const post = async (body: unknown) => {
      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      // The legacy leg may answer as SSE; take the JSON-RPC payload either way.
      const payload = text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6);
      return JSON.parse(payload);
    };
    const init = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '0' } },
    });
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(listed.result.tools.some((tool: { name: string }) => tool.name === 'create_todo')).toBe(true);
    const called = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_projects', arguments: {} } });
    expect(called.result.content[0].text).toContain('demo');
  });

  describe('MCP tasks (2026-07-28 extension)', () => {
    // Shaped like Claude Code's requests: the per-request _meta envelope.
    const modernPost = async (id: number, method: string, params: Record<string, unknown>, withTasks: boolean) => {
      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': method,
          // The 2026-07-28 transport mirrors params.name / params.taskId into Mcp-Name.
          ...(params.name ?? params.taskId ? { 'Mcp-Name': String(params.name ?? params.taskId) } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id, method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'claude-code', version: '0' },
              'io.modelcontextprotocol/clientCapabilities': withTasks ? { extensions: { 'io.modelcontextprotocol/tasks': {} } } : {},
            },
          },
        }),
      });
      return res.json();
    };
    const pollUntilSettled = async (taskId: string) => {
      for (let i = 0; i < 100; i++) {
        const { result } = await modernPost(100 + i, 'tasks/get', { taskId }, true);
        if (result.status !== 'working') return result;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('task never settled');
    };

    it('advertises the tasks extension in server/discover', async () => {
      const { result } = await modernPost(1, 'server/discover', {}, true);
      expect(result.capabilities.extensions).toHaveProperty(['io.modelcontextprotocol/tasks']);
    });

    it('wait_session_state returns a task to a declaring client and keeps waiting until the state matches', async () => {
      const created = await modernPost(2, 'tools/call', { name: 'wait_session_state', arguments: { session_id: 's-slow', state: 'blocked' } }, true);
      expect(created.result).toMatchObject({ resultType: 'task', status: 'working', ttlMs: expect.any(Number) });
      expect(created.result.taskId).toEqual(expect.any(String));
      expect(created.result.createdAt).toEqual(expect.any(String));
      expect(created.result.lastUpdatedAt).toEqual(expect.any(String));

      const settled = await pollUntilSettled(created.result.taskId);
      expect(settled.status).toBe('completed');
      expect(settled.resultType).toBe('complete');
      expect(JSON.parse(settled.result.content[0].text)).toMatchObject({ matched: true });
      expect(waitCalls.filter((id) => id === 's-slow')).toHaveLength(2);
    });

    it('wait_session_state answers directly when the client did not declare tasks', async () => {
      const { result } = await modernPost(3, 'tools/call', { name: 'wait_session_state', arguments: { session_id: 's-never', state: 'blocked', timeout_ms: 10 } }, false);
      expect(result.resultType).toBe('complete');
      expect(JSON.parse(result.content[0].text)).toMatchObject({ matched: false });
    });

    it('tasks/cancel stops a running task', async () => {
      const created = await modernPost(4, 'tools/call', { name: 'wait_session_state', arguments: { session_id: 's-never', state: 'blocked' } }, true);
      const cancelled = await modernPost(5, 'tasks/cancel', { taskId: created.result.taskId }, true);
      expect(cancelled.result.resultType).toBe('complete');
      const { result } = await modernPost(6, 'tasks/get', { taskId: created.result.taskId }, true);
      expect(result.status).toBe('cancelled');
      const missing = await modernPost(7, 'tasks/get', { taskId: 'nope' }, true);
      expect(missing.error.code).toBe(-32602);
      const undeclared = await modernPost(8, 'tasks/get', { taskId: created.result.taskId }, false);
      expect(undeclared.error.code).toBe(-32021);
    });
  });

  it('calls list_projects and returns loopback API data', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    // Claude Code negotiates the 2026-07-28 revision (needed for MCP tasks).
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('demo');
    await client.close();
  });
});
