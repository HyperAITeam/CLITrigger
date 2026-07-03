import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';

import { SqliteSessionStore } from '../auth.js';
import { closeDatabase } from '../../db/connection.js';
import type { SessionData } from 'express-session';

function sess(expiresInMs: number): SessionData {
  return {
    cookie: { expires: new Date(Date.now() + expiresInMs) },
    authenticated: true,
  } as unknown as SessionData;
}

describe('SqliteSessionStore', () => {
  let store: SqliteSessionStore;

  beforeAll(() => {
    store = new SqliteSessionStore();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('persists and retrieves a session', async () => {
    await new Promise<void>((resolve, reject) =>
      store.set('sid1', sess(60_000), (err) => (err ? reject(err) : resolve()))
    );
    const got = await new Promise<SessionData | null>((resolve, reject) =>
      store.get('sid1', (err, s) => (err ? reject(err) : resolve(s ?? null)))
    );
    expect(got).not.toBeNull();
    expect((got as any).authenticated).toBe(true);
  });

  it('returns null for expired sessions', async () => {
    await new Promise<void>((resolve, reject) =>
      store.set('sid2', sess(-1000), (err) => (err ? reject(err) : resolve()))
    );
    const got = await new Promise<SessionData | null>((resolve, reject) =>
      store.get('sid2', (err, s) => (err ? reject(err) : resolve(s ?? null)))
    );
    expect(got).toBeNull();
  });

  it('destroys sessions', async () => {
    await new Promise<void>((resolve, reject) =>
      store.set('sid3', sess(60_000), (err) => (err ? reject(err) : resolve()))
    );
    await new Promise<void>((resolve, reject) =>
      store.destroy('sid3', (err) => (err ? reject(err) : resolve()))
    );
    const got = await new Promise<SessionData | null>((resolve, reject) =>
      store.get('sid3', (err, s) => (err ? reject(err) : resolve(s ?? null)))
    );
    expect(got).toBeNull();
  });
});
