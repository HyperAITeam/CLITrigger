process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { closeDatabase } from '../../db/connection.js';
import { broadcaster } from '../../websocket/broadcaster.js';
import projectsRouter from '../projects.js';
import todosRouter from '../todos.js';
import sessionsRouter from '../sessions.js';
import plannerRouter from '../planner.js';
import schedulesRouter from '../schedules.js';

// MCP tools mutate through these routes; the UI only learns about the change
// from the broadcast, so every create/delete an MCP tool can call must emit one.

let server: Server;
let base: string;
let projectDir: string;

beforeAll(async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clitrigger-broadcast-'));
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectsRouter);
  app.use('/api', todosRouter, sessionsRouter, plannerRouter, schedulesRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
  fs.rmSync(projectDir, { recursive: true, force: true });
});

async function call(method: string, apiPath: string, body?: unknown): Promise<{ id: string }> {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  expect(res.ok, `${method} ${apiPath} → ${res.status}`).toBe(true);
  return res.status === 204 ? { id: '' } : res.json();
}

describe('MCP-reachable mutations broadcast to the UI', () => {
  it('emits an event for every create/delete', async () => {
    const broadcastSpy = vi.spyOn(broadcaster, 'broadcast');

    const project = await call('POST', '/api/projects', { name: 'demo', path: projectDir });
    await call('POST', `/api/projects/${project.id}/todos`, { title: 'todo' });
    const session = await call('POST', `/api/projects/${project.id}/sessions`, { title: 'session' });
    await call('DELETE', `/api/sessions/${session.id}`);
    const item = await call('POST', `/api/projects/${project.id}/planner`, { title: 'plan' });
    await call('DELETE', `/api/planner/${item.id}`);
    const schedule = await call('POST', `/api/projects/${project.id}/schedules`, { title: 'routine', cron_expression: '0 9 * * *' });
    await call('DELETE', `/api/schedules/${schedule.id}`);

    expect(broadcastSpy.mock.calls.map(([event]) => event.type)).toEqual([
      'projects:changed',
      'todo:created',
      'session:created',
      'session:deleted',
      'planner:changed',
      'planner:changed',
      'schedules:changed',
      'schedules:changed',
    ]);
  });
});
