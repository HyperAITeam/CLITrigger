import { ApiError, get, post } from './client';
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

// `url` targets a repository URL (e.g. an svn:externals entry) instead of the working copy.
export function getSvnLog(id: string, skip = 0, limit = 50, url?: string): Promise<GitLogResult> {
  const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
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

export function svnPropset(id: string, name: string, value: string, file?: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-propset`, { name, value, file });
}

export function svnAdd(id: string, files: string[]): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-add`, { files });
}

export function svnRevert(id: string, files: string[]): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-revert`, { files });
}

export function svnDelete(id: string, files: string[], keepLocal = false): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-delete`, { files, keepLocal });
}

export function svnResolve(id: string, files: string[], accept: 'working' | 'mine-full' | 'theirs-full' | 'base' = 'working'): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-resolve`, { files, accept });
}

export function svnChangelist(id: string, name: string | null, files: string[]): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-changelist`, { name, files });
}

export function svnCommit(id: string, message: string, files?: string[]): Promise<{ ok: boolean; revision: string | null; output: string }> {
  return post(`/api/projects/${id}/svn-commit`, { message, files });
}

// Reads the NDJSON progress stream: every {"line":…} goes to `onLine`, the
// final {"done":…} is the result, {"error":…} throws.
export async function svnUpdate(
  id: string,
  revision?: string,
  onLine?: (line: string) => void,
): Promise<{ ok: boolean; revision: string | null; output: string; conflicts: string[] }> {
  const res = await fetch(`/api/projects/${id}/svn-update`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision }),
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new ApiError(401, 'Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = '';
    try { message = JSON.parse(text).error ?? ''; } catch { /* not JSON */ }
    throw new ApiError(res.status, message || `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: { ok: boolean; revision: string | null; output: string; conflicts: string[] } | null = null;
  const handle = (raw: string) => {
    if (!raw.trim()) return;
    const msg = JSON.parse(raw) as { line?: string; done?: typeof done; error?: string };
    if (msg.error) throw new Error(msg.error);
    if (msg.done) done = msg.done;
    else if (msg.line !== undefined) onLine?.(msg.line);
  };
  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handle);
  }
  handle(buffer);
  if (!done) throw new Error('svn update ended without a result');
  return done;
}

export function svnCleanup(id: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-cleanup`, {});
}

export type { GitLogEntry };
