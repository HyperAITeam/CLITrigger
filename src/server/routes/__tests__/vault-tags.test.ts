process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { getDatabase, closeDatabase } from '../../db/connection.js';
import * as queries from '../../db/queries.js';
import vaultRouter from '../vault.js';

let server: Server;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-tags-'));
  getDatabase().prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'one', ?)`).run(root);
  const app = express();
  app.use(express.json());
  app.use('/api', vaultRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/p1/vault`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

const send = (method: string, url: string, body: unknown) =>
  fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('vault tags', () => {
  it('refuses to tag a file that does not exist', async () => {
    expect((await send('PUT', '/tags/file', { path: 'missing.md', tags: ['x'] })).status).toBe(404);
  });

  it('drops tags of files deleted outside the app and does not hand them to a new file', async () => {
    fs.writeFileSync(path.join(root, 'kept.md'), 'a');
    fs.writeFileSync(path.join(root, 'gone.md'), 'b');
    expect((await send('PUT', '/tags/file', { path: 'kept.md', tags: ['x'] })).ok).toBe(true);
    expect((await send('PUT', '/tags/file', { path: 'gone.md', tags: ['y'] })).ok).toBe(true);

    fs.unlinkSync(path.join(root, 'gone.md'));
    const listed = await (await fetch(`${base}/tags`)).json();
    expect(listed.files).toEqual({ 'kept.md': ['x'] });
    expect(queries.getVaultTags('p1').files).toEqual({ 'kept.md': ['x'] });

    // Stale row written straight to the DB: an in-app create must still start clean.
    queries.setVaultFileTags('p1', 'new.md', ['stale']);
    expect((await send('POST', '/file', { path: 'new.md', content: '' })).status).toBe(201);
    expect(queries.getVaultTags('p1').files['new.md']).toBeUndefined();
  });
});
