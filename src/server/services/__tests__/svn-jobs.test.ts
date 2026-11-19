import { describe, it, expect } from 'vitest';
import { startSvnJob, getSvnJobs, cancelSvnJob, SvnBusyError } from '../svn-jobs.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('svn jobs', () => {
  it('runs one command per working copy, tracks progress, keeps the last result', async () => {
    let finish!: (value: unknown) => void;
    const job = startSvnJob('C:/wc', 'update', ({ onLine }) => {
      onLine("Updating '.':");
      onLine('U    src/a.cpp');
      onLine('  Text conflicts: 1');
      return new Promise((resolve) => { finish = resolve; });
    }, { cancellable: true });

    // Same copy (different spelling on Windows) is busy; another copy is not.
    const sameCopy = process.platform === 'win32' ? 'c:\\WC' : 'C:/wc';
    expect(() => startSvnJob(sameCopy, 'commit', async () => null)).toThrow(SvnBusyError);
    startSvnJob('C:/other', 'cleanup', async () => null);

    expect(getSvnJobs('C:/wc').running).toMatchObject({ id: job.id, kind: 'update', count: 1, line: '  Text conflicts: 1' });

    finish({ revision: '42', conflicts: [] });
    await tick();
    const { running, last } = getSvnJobs('C:/wc');
    expect(running).toBeNull();
    expect(last).toMatchObject({ id: job.id, ok: true, result: { revision: '42', conflicts: [] } });
    expect(last?.finishedAt).toBeTruthy();
  });

  it('cancels only cancellable jobs and reports them as cancelled', async () => {
    startSvnJob('C:/plain', 'commit', () => new Promise(() => { /* never settles */ }));
    expect(cancelSvnJob('C:/plain')).toBe(false);

    startSvnJob('C:/cancel', 'update', ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('killed')));
    }), { cancellable: true });
    expect(cancelSvnJob('C:/cancel')).toBe(true);
    await tick();
    expect(getSvnJobs('C:/cancel').last).toMatchObject({ ok: false, error: 'cancelled' });
  });
});
