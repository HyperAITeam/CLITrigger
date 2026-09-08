process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setSetting } from '../db/app-settings.js';
import { closeDatabase } from '../db/connection.js';
import { mountMcp } from './index.js';

const TOKEN = 'test-mcp-token-abc';
let server: Server;
let mcpUrl: URL;

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
  app.get('/api/sessions/:id/output', (req, res) => {
    res.json({ id: req.params.id, query: req.query });
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
  const client = new Client({ name: 'test', version: '1.0.0' });
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
      'create_wiki_node',
      'delete_planner_item',
      'delete_schedule',
      'delete_session',
      'delete_wiki_node',
      'get_project_status',
      'get_session_state',
      'get_todo_logs',
      'list_projects',
      'read_session_output',
      'send_session_input',
      'start_session',
      'start_todo',
      'stop_session',
      'stop_todo',
      'wait_session_state',
    ]);
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

  it('calls list_projects and returns loopback API data', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('demo');
    await client.close();
  });
});
