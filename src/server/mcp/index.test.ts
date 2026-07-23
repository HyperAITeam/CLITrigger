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

  it('lists the 7 core tools', async () => {
    const { client, transport } = makeClient(TOKEN);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'create_project',
      'create_todo',
      'get_project_status',
      'get_todo_logs',
      'list_projects',
      'start_todo',
      'stop_todo',
    ]);
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
