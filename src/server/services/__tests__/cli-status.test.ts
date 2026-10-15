import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

import { getToolStatus, clearCache } from '../cli-status.js';

type Callback = (error: Error | null, stdout: string) => void;

// First execFile call is `<command> --version`; the PATH probe (`where`/`which`)
// follows only when that one errors.
function respond(handler: (command: string) => Error | null) {
  execFileMock.mockImplementation((command: string, _args: string[], _opts: unknown, callback: Callback) => {
    callback(handler(command), '');
  });
}

describe('getToolStatus', () => {
  beforeEach(() => {
    clearCache();
    execFileMock.mockReset();
  });

  it('reports installed when --version fails (timeout/non-zero) but the command is on PATH', async () => {
    respond((command) => (command === 'claude' ? Object.assign(new Error('timed out'), { killed: true }) : null));
    expect(await getToolStatus('claude')).toEqual({ tool: 'claude', installed: true, version: null });
  });

  it('reports not installed when the command is missing from PATH', async () => {
    respond(() => new Error('not found'));
    expect(await getToolStatus('claude')).toEqual({ tool: 'claude', installed: false, version: null });
  });
});
