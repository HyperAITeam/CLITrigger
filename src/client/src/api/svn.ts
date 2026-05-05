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

export interface SvnStatusResult {
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  revision: string | null;
}

export function getSvnStatus(id: string, showUpdates = false): Promise<SvnStatusResult> {
  const qs = showUpdates ? '?showUpdates=true' : '';
  return get(`/api/projects/${id}/svn-status${qs}`);
}

export function getSvnInfo(id: string): Promise<SvnInfo> {
  return get(`/api/projects/${id}/svn-info`);
}

export function getSvnLog(id: string, skip = 0, limit = 50): Promise<GitLogResult> {
  const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
  return get(`/api/projects/${id}/svn-log?${params}`);
}

export function getSvnCommitFiles(id: string, revision: string): Promise<{ files: CommitFile[] }> {
  return get(`/api/projects/${id}/svn-commit-files?revision=${encodeURIComponent(revision)}`);
}

export function getSvnCommitDiff(id: string, revision: string, file?: string): Promise<{ diff: string }> {
  const params = new URLSearchParams({ revision });
  if (file) params.set('file', file);
  return get(`/api/projects/${id}/svn-commit-diff?${params}`);
}

export function getSvnDiff(id: string, file?: string): Promise<{ diff: string }> {
  const params = new URLSearchParams();
  if (file) params.set('file', file);
  const qs = params.toString();
  return get(`/api/projects/${id}/svn-diff${qs ? `?${qs}` : ''}`);
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

export function svnCommit(id: string, message: string, files?: string[]): Promise<{ ok: boolean; revision: string | null; output: string }> {
  return post(`/api/projects/${id}/svn-commit`, { message, files });
}

export function svnUpdate(id: string, revision?: string): Promise<{ ok: boolean; revision: string | null; output: string }> {
  return post(`/api/projects/${id}/svn-update`, { revision });
}

export function svnCleanup(id: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/svn-cleanup`, {});
}

export type { GitLogEntry };
