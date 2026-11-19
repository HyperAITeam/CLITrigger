import { get, post } from './client';
import type { CommitFile, GitStatusFile, GitLogEntry, GitLogResult } from './projects';

// SVN reuses git-shaped types so DiffViewer/CommitFileList work unchanged.
// Hash slot carries the SVN revision number as string (e.g. "12345").

export interface SvnInfo {
  url: string;
  relativeUrl: string;
  repositoryRoot: string;
  revision: string;
}

// Git-shaped status file plus native SVN changelist membership.
export interface SvnFile extends GitStatusFile {
  changelist?: string;
}

export interface SvnStatusResult {
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: SvnFile[];
  revision: string | null;
}

export function getSvnStatus(id: string, showUpdates = false): Promise<SvnStatusResult> {
  const qs = showUpdates ? '?showUpdates=true' : '';
  return get(`/api/projects/${id}/svn-status${qs}`);
}

export function getSvnInfo(id: string): Promise<SvnInfo> {
  return get(`/api/projects/${id}/svn-info`);
}

// `url` targets a repository URL (e.g. an svn:externals entry) instead of the
// working copy. `before` = the oldest revision already shown (next page).
export function getSvnLog(id: string, before?: string, limit = 50, url?: string): Promise<GitLogResult> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  if (url) params.set('url', url);
  return get(`/api/projects/${id}/svn-log?${params}`);
}

export function getSvnUrlInfo(id: string, url: string): Promise<{ revision: string }> {
  return get(`/api/projects/${id}/svn-url-info?url=${encodeURIComponent(url)}`);
}

export function getSvnCommitFiles(id: string, revision: string): Promise<{ files: CommitFile[] }> {
  return get(`/api/projects/${id}/svn-commit-files?revision=${encodeURIComponent(revision)}`);
}

export function getSvnCommitDiff(id: string, revision: string, file?: string, status?: string): Promise<{ diff: string }> {
  const params = new URLSearchParams({ revision });
  if (file) params.set('file', file);
  if (status) params.set('status', status);
  return get(`/api/projects/${id}/svn-commit-diff?${params}`);
}

export function getSvnDiff(id: string, file?: string, revision?: string): Promise<{ diff: string }> {
  const params = new URLSearchParams();
  if (file) params.set('file', file);
  if (revision) params.set('revision', revision);
  const qs = params.toString();
  return get(`/api/projects/${id}/svn-diff${qs ? `?${qs}` : ''}`);
}

export interface SvnProperty {
  name: string;
  value: string;
}

export function getSvnProperties(id: string, file?: string): Promise<{ properties: SvnProperty[] }> {
  const params = new URLSearchParams();
  if (file) params.set('file', file);
  const qs = params.toString();
  return get(`/api/projects/${id}/svn-properties${qs ? `?${qs}` : ''}`);
}

// ── Commands (server-side jobs) ──────────────────────────────────────────────
// Every mutating command runs as a job on the server, one at a time per
// working copy: the POST returns the job id at once and the client polls
// /svn-job. A command therefore outlives the panel (tab switch, reload) and a
// remounted panel picks it up again.

export type SvnJobKind = 'update' | 'commit' | 'cleanup' | 'add' | 'revert' | 'delete' | 'resolve' | 'changelist' | 'propset';

export interface SvnJob {
  id: string;
  kind: SvnJobKind;
  revision?: string;
  cancellable: boolean;
  startedAt: string;
  count: number;          // files touched so far (update progress)
  line: string;           // latest progress line
  finishedAt?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;         // 'cancelled' when stopped by the user
}

export function getSvnJobs(id: string): Promise<{ running: SvnJob | null; last: SvnJob | null }> {
  return get(`/api/projects/${id}/svn-job`);
}

export function cancelSvnJob(id: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-job/cancel`, {});
}

// Jobs this window started or watched whose result no panel has applied yet.
const unconsumedJobs = new Set<string>();
const JOB_POLL_MS = 500;
const JOB_POLL_MAX_FAILURES = 10;

/** Start a command; resolves with its job id. A 409 ApiError means another command holds the copy. */
export async function startSvnJob(id: string, kind: SvnJobKind, body: Record<string, unknown>): Promise<string> {
  const { jobId } = await post<{ jobId: string }>(`/api/projects/${id}/svn-${kind}`, body);
  unconsumedJobs.add(jobId);
  return jobId;
}

/**
 * Poll until job `jobId` finishes and return it (ok or not). `onProgress`
 * gets the running job on every poll. Returns null once `signal` aborts —
 * the job keeps running and the next `findSvnJobToAttach` picks it up.
 */
export async function waitSvnJob(
  id: string,
  jobId: string,
  opts: { signal?: AbortSignal; onProgress?: (job: SvnJob) => void } = {},
): Promise<SvnJob | null> {
  let failures = 0;
  for (;;) {
    if (opts.signal?.aborted) return null;
    let state: { running: SvnJob | null; last: SvnJob | null };
    try {
      state = await getSvnJobs(id);
      failures = 0;
    } catch (err) {
      // A blip (server busy, tunnel hiccup) must not abandon a long update.
      if (++failures >= JOB_POLL_MAX_FAILURES) throw err;
      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
      continue;
    }
    if (opts.signal?.aborted) return null;
    if (state.running?.id === jobId) {
      opts.onProgress?.(state.running);
    } else {
      unconsumedJobs.delete(jobId);
      if (state.last?.id === jobId) return state.last;
      throw new Error('SVN command state was lost (server restarted?)');
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
  }
}

/** The job a freshly mounted panel should show: a running one, or a finished one nobody applied yet. */
export async function findSvnJobToAttach(id: string): Promise<SvnJob | null> {
  const { running, last } = await getSvnJobs(id);
  if (running) {
    unconsumedJobs.add(running.id);
    return running;
  }
  if (last && unconsumedJobs.delete(last.id)) return last;
  return null;
}

/** Start a command and wait for it: its result, or its error thrown. */
export async function runSvnJob<T>(id: string, kind: SvnJobKind, body: Record<string, unknown>): Promise<T> {
  const job = await waitSvnJob(id, await startSvnJob(id, kind, body));
  if (!job?.ok) throw new Error(job?.error ?? 'SVN command failed');
  return job.result as T;
}

export function svnPropset(id: string, name: string, value: string, file?: string): Promise<void> {
  return runSvnJob(id, 'propset', { name, value, file });
}

export type { GitLogEntry };
