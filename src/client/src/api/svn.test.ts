import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SvnJob } from './svn';

vi.mock('./client', () => ({ get: vi.fn(), post: vi.fn() }));

const { get, post } = await import('./client');
const svn = await import('./svn');

const job = (id: string, extra: Partial<SvnJob> = {}): SvnJob =>
  ({ id, kind: 'update', cancellable: true, startedAt: '', count: 0, line: '', ...extra });
const state = (running: SvnJob | null, last: SvnJob | null) => ({ running, last });

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(get).mockReset();
  vi.mocked(post).mockReset();
});

describe('svn jobs across a panel remount', () => {
  it('lets a remounted panel pick up a job the unmounted one stopped following, and apply it once', async () => {
    vi.useFakeTimers();
    vi.mocked(post).mockResolvedValue({ jobId: 'b-1' });
    const jobId = await svn.startSvnJob('p1', 'update', {});

    // Panel A follows, then unmounts mid-update.
    vi.mocked(get).mockResolvedValue(state(job('b-1', { count: 3 }), null));
    const controller = new AbortController();
    const seen: number[] = [];
    const following = svn.waitSvnJob('p1', jobId, { signal: controller.signal, onProgress: (j) => seen.push(j.count) });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(600);
    expect(await following).toBeNull();
    expect(seen).toEqual([3]);

    // Finished while no panel was mounted: panel B gets the result exactly once.
    const finished = job('b-1', { finishedAt: 'x', ok: true, result: { revision: '42', conflicts: [] } });
    vi.mocked(get).mockResolvedValue(state(null, finished));
    expect(await svn.findSvnJobToAttach('p1')).toEqual(finished);
    expect(await svn.findSvnJobToAttach('p1')).toBeNull();
  });

  it("ignores another window's old result but follows a job that is still running", async () => {
    vi.mocked(get).mockResolvedValue(state(null, job('b-9', { finishedAt: 'x', ok: true })));
    expect(await svn.findSvnJobToAttach('p1')).toBeNull();

    vi.mocked(get).mockResolvedValue(state(job('b-10'), null));
    expect((await svn.findSvnJobToAttach('p1'))?.id).toBe('b-10');
  });

  it('keeps polling through a transient failure and returns the finished job', async () => {
    vi.useFakeTimers();
    vi.mocked(get)
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(state(job('b-2'), null))
      .mockResolvedValue(state(null, job('b-2', { finishedAt: 'x', ok: false, error: 'cancelled' })));
    const waiting = svn.waitSvnJob('p1', 'b-2');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await waiting).toMatchObject({ id: 'b-2', ok: false, error: 'cancelled' });
  });
});
