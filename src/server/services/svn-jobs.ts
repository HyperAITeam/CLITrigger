import nodePath from 'path';

// Mutating svn commands run as server-side jobs, one at a time per working
// copy. The HTTP request that starts a job returns at once; clients poll the
// job state. So a command survives the panel unmounting (tab switch, reload,
// a proxy cutting a long request) and a second command can't collide with the
// working-copy lock of one still running.

export type SvnJobKind = 'update' | 'commit' | 'cleanup' | 'add' | 'revert' | 'delete' | 'resolve' | 'changelist' | 'propset';

export interface SvnJob {
  id: string;
  kind: SvnJobKind;
  revision?: string;      // update -r target
  cancellable: boolean;
  startedAt: string;
  count: number;          // progress lines that touched a path
  line: string;           // latest progress line
  finishedAt?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

export interface SvnJobContext {
  onLine: (line: string) => void;
  signal: AbortSignal;
}

export class SvnBusyError extends Error {
  constructor(public readonly running: SvnJob) {
    super(`Another SVN command is still running (${running.kind})`);
  }
}

// Job ids carry a boot nonce so a client never mistakes a job of a restarted
// server for one it already handled.
const BOOT = Date.now().toString(36);
let seq = 0;

interface WcJobs {
  running: SvnJob | null;
  abort: AbortController | null;
  last: SvnJob | null;
}
const byWc = new Map<string, WcJobs>();

// `svn update` progress row: 4 status columns, a space, the path.
const PROGRESS_PATH_LINE = /^[ADUCGER ][UCG ][B ][C ] \S/;

function wcKey(wcPath: string): string {
  const resolved = nodePath.resolve(wcPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function startSvnJob(
  wcPath: string,
  kind: SvnJobKind,
  run: (ctx: SvnJobContext) => Promise<unknown>,
  meta: { revision?: string; cancellable?: boolean } = {},
): SvnJob {
  const key = wcKey(wcPath);
  const state = byWc.get(key) ?? { running: null, abort: null, last: null };
  byWc.set(key, state);
  if (state.running) throw new SvnBusyError(state.running);

  const job: SvnJob = {
    id: `${BOOT}-${++seq}`,
    kind,
    ...(meta.revision ? { revision: meta.revision } : {}),
    cancellable: !!meta.cancellable,
    startedAt: new Date().toISOString(),
    count: 0,
    line: '',
  };
  const abort = new AbortController();
  state.running = job;
  state.abort = abort;

  const onLine = (line: string) => {
    job.line = line;
    if (PROGRESS_PATH_LINE.test(line)) job.count += 1;
  };
  run({ onLine, signal: abort.signal }).then(
    (result) => { job.ok = true; job.result = result; },
    (err: unknown) => {
      job.ok = false;
      job.error = abort.signal.aborted ? 'cancelled' : err instanceof Error ? err.message : String(err);
    },
  ).finally(() => {
    job.finishedAt = new Date().toISOString();
    state.running = null;
    state.abort = null;
    state.last = job;
  });
  return job;
}

export function getSvnJobs(wcPath: string): { running: SvnJob | null; last: SvnJob | null } {
  const state = byWc.get(wcKey(wcPath));
  return { running: state?.running ?? null, last: state?.last ?? null };
}

/** Abort the running job when it allows it. Returns false when there is nothing to cancel. */
export function cancelSvnJob(wcPath: string): boolean {
  const state = byWc.get(wcKey(wcPath));
  if (!state?.running?.cancellable || !state.abort) return false;
  state.abort.abort();
  return true;
}
