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
const { vaultWatcher } = await import('../vault-watcher.js');

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
