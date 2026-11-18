process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { getDatabase, closeDatabase } from '../../db/connection.js';
import sessionsRouter from '../sessions.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const db = getDatabase();
  db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'one', '/tmp/one'), ('p2', 'two', '/tmp/two')`).run();
  const app = express();
  app.use(express.json());
  app.use('/api', sessionsRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
});

async function call<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  expect(res.ok, `${method} ${apiPath} → ${res.status}`).toBe(true);
  return res.json() as Promise<T>;
}

const create = (projectId: string, title: string) =>
  call<{ id: string }>('POST', `/api/projects/${projectId}/sessions`, { title });
const titles = async (projectId: string) =>
  (await call<{ title: string }[]>('GET', `/api/projects/${projectId}/sessions`)).map((session) => session.title);

describe('session reorder', () => {
  it('keeps the dragged order, puts new sessions on top, ignores other projects', async () => {
    const a = await create('p1', 'A');
    const b = await create('p1', 'B');
    const c = await create('p1', 'C');
    const foreign = await create('p2', 'X');

    await call('POST', '/api/projects/p1/sessions/reorder', { ids: [c.id, a.id, foreign.id, b.id] });
    expect(await titles('p1')).toEqual(['C', 'A', 'B']);

    // created_at has ms resolution; make sure the new row is strictly newer.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await create('p1', 'N');
    expect(await titles('p1')).toEqual(['N', 'C', 'A', 'B']);

    const [x] = await call<{ sort_order: number }[]>('GET', '/api/projects/p2/sessions');
    expect(x.sort_order).toBe(0);
  });

  it('rejects a non-array body', async () => {
    const res = await fetch(`${base}/api/projects/p1/sessions/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('sub-session parent', () => {
  it('stores parent_session_id and rejects an unknown parent', async () => {
    const lead = await create('p2', 'Lead');
    const child = await call<{ parent_session_id: string | null }>('POST', '/api/projects/p2/sessions', { title: 'Child', parent_session_id: lead.id });
    expect(child.parent_session_id).toBe(lead.id);

    const res = await fetch(`${base}/api/projects/p2/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Orphan', parent_session_id: 'no-such-session' }),
    });
    expect(res.status).toBe(400);
  });
});
