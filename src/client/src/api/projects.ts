import { get, post, put, del } from './client';
import type { Project } from '../types';

// --- Folder Browser ---

export function browseNativeFolder(initialPath?: string): Promise<{ path: string | null }> {
  return post('/api/projects/browse', { initialPath });
}

export function openFolder(path: string): Promise<{ ok: boolean }> {
  return post('/api/projects/open-folder', { path });
}

export function getProjects(): Promise<Project[]> {
  return get('/api/projects');
}

export function getProject(id: string): Promise<Project> {
  return get(`/api/projects/${id}`);
}

export function createProject(data: { name: string; path: string }): Promise<Project> {
  return post('/api/projects', data);
}

export function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'path' | 'default_branch' | 'max_concurrent' | 'claude_model' | 'claude_options' | 'cli_tool' | 'gstack_enabled' | 'gstack_skills' | 'jira_enabled' | 'jira_base_url' | 'jira_email' | 'jira_api_token' | 'jira_project_key' | 'notion_enabled' | 'notion_api_key' | 'notion_database_id' | 'github_enabled' | 'github_token' | 'github_owner' | 'github_repo' | 'cli_fallback_chain' | 'default_max_turns' | 'sandbox_mode' | 'debug_logging' | 'use_worktree' | 'show_token_usage'>>): Promise<Project> {
  return put(`/api/projects/${id}`, data);
}

// --- Debug Logs ---

export interface DebugLogFile {
  name: string;
  todoId: string;
  timestamp: string;
  size: number;
}

export function getDebugLogs(projectId: string, todoId?: string): Promise<{ files: DebugLogFile[] }> {
  const qs = todoId ? `?todoId=${encodeURIComponent(todoId)}` : '';
  return get(`/api/projects/${projectId}/debug-logs${qs}`);
}

export function getDebugLogContent(projectId: string, filename: string): Promise<string> {
  return get(`/api/projects/${projectId}/debug-logs/${encodeURIComponent(filename)}`);
}

export function deleteDebugLog(projectId: string, filename: string): Promise<void> {
  return del(`/api/projects/${projectId}/debug-logs/${encodeURIComponent(filename)}`);
}

export function deleteAllDebugLogs(projectId: string): Promise<void> {
  return del(`/api/projects/${projectId}/debug-logs`);
}

export function deleteProject(id: string): Promise<void> {
  return del(`/api/projects/${id}`);
}

export function startProject(id: string): Promise<void> {
  return post(`/api/projects/${id}/start`);
}

export function stopProject(id: string): Promise<void> {
  return post(`/api/projects/${id}/stop`);
}

export function getProjectStatus(id: string): Promise<{ running: number; completed: number; total: number }> {
  return get(`/api/projects/${id}/status`);
}

export function checkGitStatus(id: string): Promise<Project> {
  return post(`/api/projects/${id}/check-git`);
}

export interface GitStatusFile {
  path: string;
  index: string;
  working_dir: string;
}

export interface GitStatusResult {
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
}

export function getGitStatusTree(id: string, worktreePath?: string): Promise<GitStatusResult> {
  const qs = worktreePath ? `?worktreePath=${encodeURIComponent(worktreePath)}` : '';
  return get(`/api/projects/${id}/git-status${qs}`);
}

// Git Log (commit history)
export interface GitLogEntry {
  hash: string;
  parentHashes: string[];
  refs: string[];
  message: string;
  author: string;
  date: string;
}

export interface GitLogResult {
  commits: GitLogEntry[];
  hasMore: boolean;
}

export function getGitLog(id: string, skip = 0, limit = 50, worktreePath?: string): Promise<GitLogResult> {
  const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
  if (worktreePath) params.set('worktreePath', worktreePath);
  return get(`/api/projects/${id}/git-log?${params}`);
}

// Git Refs (branches, tags, stashes)
export interface GitRef {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitRefsResult {
  branches: GitRef[];
  tags: string[];
  stashCount: number;
}

export function getGitRefs(id: string, worktreePath?: string): Promise<GitRefsResult> {
  const qs = worktreePath ? `?worktreePath=${encodeURIComponent(worktreePath)}` : '';
  return get(`/api/projects/${id}/git-refs${qs}`);
}

// --- Git actions ---

export function gitStage(id: string, files: string[]): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-stage`, { files });
}

export function gitUnstage(id: string, files: string[]): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-unstage`, { files });
}

export function gitCommit(id: string, message: string): Promise<{ ok: boolean; commit: string }> {
  return post(`/api/projects/${id}/git-commit`, { message });
}

export function gitPull(id: string, remote?: string, branch?: string): Promise<{ ok: boolean; summary: string }> {
  return post(`/api/projects/${id}/git-pull`, { remote, branch });
}

export function gitPush(id: string, remote?: string, branch?: string, setUpstream?: boolean): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-push`, { remote, branch, setUpstream });
}

export function gitFetch(id: string, remote?: string, prune?: boolean): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-fetch`, { remote, prune });
}

export function gitCreateBranch(id: string, name: string, startPoint?: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-branch`, { name, startPoint });
}

export function gitDeleteBranch(id: string, name: string, force?: boolean): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-branch-delete`, { name, force });
}

export function gitCheckout(id: string, branch: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-checkout`, { branch });
}

export function gitMerge(id: string, branch: string): Promise<{ ok: boolean; result: string }> {
  return post(`/api/projects/${id}/git-merge`, { branch });
}

export function gitStashPush(id: string, message?: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-stash`, { message });
}

export function gitStashPop(id: string, index?: number): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-stash-pop`, { index });
}

export interface GitStashEntry {
  index: number;
  message: string;
}

export function gitStashList(id: string): Promise<GitStashEntry[]> {
  return get(`/api/projects/${id}/git-stash-list`);
}

export function gitDiscard(id: string, files?: string[], all?: boolean): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-discard`, { files, all });
}

export function gitCreateTag(id: string, name: string, message?: string, commit?: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-tag`, { name, message, commit });
}

export function gitDeleteTag(id: string, name: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-tag-delete`, { name });
}

export function gitRenameBranch(id: string, oldName: string, newName: string): Promise<{ ok: boolean }> {
  return post(`/api/projects/${id}/git-branch-rename`, { oldName, newName });
}

export function gitRebase(id: string, onto: string): Promise<{ ok: boolean; result: string }> {
  return post(`/api/projects/${id}/git-rebase`, { onto });
}

export function gitDiff(id: string, file?: string, staged?: boolean): Promise<{ diff: string }> {
  const params = new URLSearchParams();
  if (file) params.set('file', file);
  if (staged) params.set('staged', 'true');
  return get(`/api/projects/${id}/git-diff?${params}`);
}

// Commit detail
export interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  oldPath?: string;
}

export function getCommitFiles(id: string, hash: string): Promise<{ files: CommitFile[] }> {
  const params = new URLSearchParams({ hash });
  return get(`/api/projects/${id}/git-commit-files?${params}`);
}

export function getCommitDiff(id: string, hash: string, file?: string): Promise<{ diff: string }> {
  const params = new URLSearchParams({ hash });
  if (file) params.set('file', file);
  return get(`/api/projects/${id}/git-commit-diff?${params}`);
}
