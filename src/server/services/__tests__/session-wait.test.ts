process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as queries from '../../db/queries.js';
import { closeDatabase } from '../../db/connection.js';
import { broadcaster } from '../../websocket/broadcaster.js';
import { sessionManager } from '../session-manager.js';

let runningId: string;
let pendingId: string;

beforeAll(() => {
  const project = queries.createProject('wait-test', 'F:/tmp/wait-test');
  runningId = queries.createSession(project.id, 'running').id;
  pendingId = queries.createSession(project.id, 'pending').id;
  queries.updateSessionStatus(runningId, 'running');
});

afterAll(() => {
  closeDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(broadcaster.listenerCount('session:agent-state')).toBe(0);
  expect(broadcaster.listenerCount('session:status-changed')).toBe(0);
});

describe('sessionManager.waitForAgentState', () => {
  it('resolves immediately when already in the target state', async () => {
    vi.spyOn(sessionManager, 'getAgentState').mockReturnValue('blocked');
    const result = await sessionManager.waitForAgentState(runningId, 'blocked', 5_000);
    expect(result).toEqual({ matched: true, status: 'running', agent_state: 'blocked' });
  });

  it('resolves immediately with matched=false when the session is not running', async () => {
    vi.spyOn(sessionManager, 'getAgentState').mockReturnValue('unknown');
    const result = await sessionManager.waitForAgentState(pendingId, 'blocked', 5_000);
    expect(result).toEqual({ matched: false, status: 'pending', agent_state: 'unknown' });
  });

  it('resolves matched=true when the target transition is broadcast', async () => {
    const spy = vi.spyOn(sessionManager, 'getAgentState').mockReturnValue('working');
    const promise = sessionManager.waitForAgentState(runningId, 'blocked', 5_000);
    spy.mockReturnValue('blocked');
    broadcaster.broadcast({ type: 'session:agent-state', sessionId: runningId, state: 'blocked' });
    await expect(promise).resolves.toEqual({ matched: true, status: 'running', agent_state: 'blocked' });
  });

  it('ignores other sessions and times out with matched=false', async () => {
    vi.useFakeTimers();
    vi.spyOn(sessionManager, 'getAgentState').mockReturnValue('working');
    let settled = false;
    const promise = sessionManager.waitForAgentState(runningId, 'blocked', 1_000).then((r) => { settled = true; return r; });

    broadcaster.broadcast({ type: 'session:agent-state', sessionId: 'someone-else', state: 'blocked' });
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toEqual({ matched: false, status: 'running', agent_state: 'working' });
  });

  it('resolves early when the process leaves running', async () => {
    vi.spyOn(sessionManager, 'getAgentState').mockReturnValue('working');
    const promise = sessionManager.waitForAgentState(runningId, 'blocked', 5_000);
    broadcaster.broadcast({ type: 'session:status-changed', sessionId: runningId, status: 'stopped' });
    await expect(promise).resolves.toEqual({ matched: false, status: 'running', agent_state: 'working' });
  });
});
