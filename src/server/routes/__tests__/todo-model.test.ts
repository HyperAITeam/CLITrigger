process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { closeDatabase } from '../../db/connection.js';
import { getAdapter } from '../../services/cli-adapters.js';
import projectsRouter from '../projects.js';
import todosRouter from '../todos.js';

let server: Server;
let base: string;
let projectDir: string;

beforeAll(async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clitrigger-todo-model-'));
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectsRouter);
  app.use('/api', todosRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
  fs.rmSync(projectDir, { recursive: true, force: true });
});

async function call(method: string, apiPath: string, body?: unknown) {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe('per-task model', () => {
  it('stores a picked model, rejects unsafe names, and drops it when the CLI changes', async () => {
    const project = (await call('POST', '/api/projects', { name: 'demo', path: projectDir })).json;

    const created = await call('POST', `/api/projects/${project.id}/todos`, { title: 't', cli_tool: 'claude', cli_model: 'claude-sonnet-4-5[1m]' });
    expect(created.status).toBe(201);
    expect(created.json.cli_model).toBe('claude-sonnet-4-5[1m]');

    const unsafe = await call('POST', `/api/projects/${project.id}/todos`, { title: 't', cli_model: 'opus & calc' });
    expect(unsafe.status).toBe(400);

    const sameTool = await call('PUT', `/api/todos/${created.json.id}`, { cli_tool: 'claude', title: 't2' });
    expect(sameTool.json.cli_model).toBe('claude-sonnet-4-5[1m]');
    const otherTool = await call('PUT', `/api/todos/${created.json.id}`, { cli_tool: 'codex' });
    expect(otherTool.json.cli_model).toBeNull();
  });

  it('passes a model name to the CLI without checking a model list', () => {
    const args = getAdapter('claude').buildArgs({ mode: 'headless', prompt: '', model: 'opus' });
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus']));
  });
});
