import { get, post, put, del } from './client';
import type { Session, SessionLog } from '../types';

export function getSessions(projectId: string): Promise<Session[]> {
  return get(`/api/projects/${projectId}/sessions`);
}

// Single-session lookup by id, project-agnostic. Used to resolve sessions
// that live in a window group but belong to another project
// (cross-project docking).
export function getSession(id: string): Promise<Session> {
  return get(`/api/sessions/${id}`);
}

// Diff of everything the session changed since it started (committed +
// uncommitted). available:false when the project isn't a git repo.
export interface SessionDiffFile {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
  binary: boolean;
}

export function getSessionDiff(id: string): Promise<{ available: boolean; reason?: string; files?: SessionDiffFile[]; base?: string | null }> {
  return get(`/api/sessions/${id}/diff`);
}

export function getSessionFileDiff(id: string, filePath: string): Promise<{ available: boolean; reason?: string; diff?: string }> {
  const params = new URLSearchParams({ path: filePath });
  return get(`/api/sessions/${id}/diff/file?${params}`);
}

export function createSession(
  projectId: string,
  data: { title: string; description?: string; cli_tool?: string; use_worktree?: boolean; memory_inject_mode?: 'none' | 'all' | 'selected' | 'auto'; memory_node_ids?: string[]; memory_raw_file_paths?: string[]; tag_id?: string | null }
): Promise<Session> {
  return post(`/api/projects/${projectId}/sessions`, data);
}

export function updateSession(
  id: string,
  data: { title?: string; description?: string; cli_tool?: string; use_worktree?: boolean; memory_inject_mode?: 'none' | 'all' | 'selected' | 'auto'; memory_node_ids?: string[]; memory_raw_file_paths?: string[]; tag_id?: string | null }
): Promise<Session> {
  return put(`/api/sessions/${id}`, data);
}

export function deleteSession(id: string): Promise<void> {
  return del(`/api/sessions/${id}`);
}

export function startSession(
  id: string,
  dims?: { cols: number; rows: number },
  opts?: { continueSession?: boolean },
): Promise<Session & { pendingInitialPrompt?: boolean; pendingInitialPromptLength?: number }> {
  const body: Record<string, unknown> | undefined = dims
    ? { ...dims, ...(opts?.continueSession ? { continueSession: true } : {}) }
    : opts?.continueSession ? { continueSession: true } : undefined;
  return post(`/api/sessions/${id}/start`, body);
}

export function getPendingInitialPrompt(id: string): Promise<{ prompt: string | null; length: number }> {
  return get(`/api/sessions/${id}/pending-prompt`);
}

export function submitInitialPrompt(id: string): Promise<{ submitted: boolean }> {
  return post(`/api/sessions/${id}/submit-initial`, {});
}

export function skipInitialPrompt(id: string): Promise<{ skipped: boolean }> {
  return post(`/api/sessions/${id}/skip-initial`, {});
}

export function stopSession(id: string): Promise<Session> {
  return post(`/api/sessions/${id}/stop`);
}

export function getSessionLogs(id: string): Promise<SessionLog[]> {
  return get(`/api/sessions/${id}/logs`);
}

export function cleanupSession(id: string, deleteBranch = true): Promise<{ success: boolean; worktreeRemoved: boolean; branchDeleted: boolean; worktreeError?: string; branchError?: string }> {
  return post(`/api/sessions/${id}/cleanup`, { delete_branch: deleteBranch });
}

export function pasteImage(id: string, data: string, name?: string): Promise<{ pasted: true }> {
  return post(`/api/sessions/${id}/paste-image`, { data, name });
}

export function getClipboardImagePath(id: string): Promise<{ path: string | null }> {
  return get(`/api/sessions/${id}/clipboard-image-path`);
}
