import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../db/queries.js', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('../../websocket/broadcaster.js', () => ({
  broadcaster: {
    broadcast: vi.fn(),
  },
}));

const { getProjectById } = await import('../../db/queries.js');
const { broadcaster } = await import('../../websocket/broadcaster.js');
const { vaultWatcher, gitWatchAccepts } = await import('../vault-watcher.js');

// The 500ms broadcast throttle plus OS event delivery latency.
const EVENT_WAIT_MS = 2000;
const SILENCE_WAIT_MS = 900;

describe('vaultWatcher', () => {
  let tmpDir: string;
  const ws = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-watch-'));
    vi.mocked(getProjectById).mockReturnValue({ id: 'p1', path: tmpDir } as never);
  });

  afterEach(() => {
    vaultWatcher.removeClient(ws);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('broadcasts vault:changed when a file appears in the watched root', async () => {
    vaultWatcher.watch('p1', ws);
    fs.writeFileSync(path.join(tmpDir, 'note.md'), 'hello');

    await vi.waitFor(() => {
      expect(broadcaster.broadcast).toHaveBeenCalledWith({ type: 'vault:changed', projectId: 'p1' });
    }, { timeout: EVENT_WAIT_MS });
  });

  it('ignores changes inside excluded directories like node_modules', async () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    vaultWatcher.watch('p1', ws);
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), 'x');

    await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS));
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('stops broadcasting after the last client unwatches', async () => {
    vaultWatcher.watch('p1', ws);
    vaultWatcher.unwatch('p1', ws);
    fs.writeFileSync(path.join(tmpDir, 'note.md'), 'hello');

    await new Promise((resolve) => setTimeout(resolve, SILENCE_WAIT_MS));
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('no-ops when the project is unknown', () => {
    vi.mocked(getProjectById).mockReturnValue(undefined);
    vaultWatcher.watch('missing', ws);
    // Nothing to assert beyond "does not throw"; unwatch of an unknown id is safe too.
    vaultWatcher.unwatch('missing', ws);
  });
});

describe('gitWatchAccepts', () => {
  const accepts = (rel: string) => gitWatchAccepts(rel.split(/[\\/]/));

  it('accepts working-tree files and session worktrees', () => {
    expect(accepts('src/app.ts')).toBe(true);
    expect(accepts('.worktrees/task-1/src/app.ts')).toBe(true);
  });

  it('rejects build/dependency churn, also inside worktrees', () => {
    expect(accepts('node_modules/pkg/index.js')).toBe(false);
    expect(accepts('.worktrees/task-1/node_modules/pkg/index.js')).toBe(false);
  });

  it('accepts only ref/state moves inside .git — never the index', () => {
    expect(accepts('.git/HEAD')).toBe(true);
    expect(accepts('.git/refs/heads/main')).toBe(true);
    expect(accepts('.git/worktrees/task-1/HEAD')).toBe(true);
    expect(accepts('.git/MERGE_HEAD')).toBe(true);
    // index/objects would loop: reading status can rewrite the index.
    expect(accepts('.git/index')).toBe(false);
    expect(accepts('.git/objects/ab/cdef')).toBe(false);
  });
});
