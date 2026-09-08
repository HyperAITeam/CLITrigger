process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { getDatabase, closeDatabase } from '../../db/connection.js';
import analyticsRouter from '../analytics.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const db = getDatabase();
  db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'demo', '/tmp/demo')`).run();
  // Two finished todos created in the past — both counted before Clear.
  db.prepare(`INSERT INTO todos (id, project_id, title, status, created_at) VALUES ('t1', 'p1', 'a', 'completed', datetime('now', '-1 hour'))`).run();
  db.prepare(`INSERT INTO todos (id, project_id, title, status, created_at) VALUES ('t2', 'p1', 'b', 'failed', datetime('now', '-1 hour'))`).run();
  const app = express();
  app.use('/api', analyticsRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
});

async function summary() {
  const res = await fetch(`${base}/api/projects/p1/analytics`);
  return ((await res.json()) as { summary: { totalTasks: number } }).summary;
}

describe('analytics clear', () => {
  it('hides todos created before the clear watermark and keeps later ones', async () => {
    expect((await summary()).totalTasks).toBe(2);

    const res = await fetch(`${base}/api/projects/p1/analytics/clear`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await summary()).totalTasks).toBe(0);

    // A todo created after Clear is counted again.
    getDatabase().prepare(`INSERT INTO todos (id, project_id, title, status, created_at) VALUES ('t3', 'p1', 'c', 'completed', datetime('now', '+1 hour'))`).run();
    expect((await summary()).totalTasks).toBe(1);

    // Clear is non-destructive — every todo row is still there.
    expect((getDatabase().prepare(`SELECT COUNT(*) AS n FROM todos`).get() as { n: number }).n).toBe(3);
  });
});
