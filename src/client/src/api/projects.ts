import { get, post, put, del } from './client';
import type { Project } from '../types';

export function getProjects(): Promise<Project[]> {
  return get('/api/projects');
}

export function getProject(id: string): Promise<Project> {
  return get(`/api/projects/${id}`);
}

export function createProject(data: { name: string; path: string }): Promise<Project> {
  return post('/api/projects', data);
}

export function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'path' | 'default_branch' | 'max_concurrent' | 'claude_model' | 'claude_options' | 'cli_tool' | 'gstack_enabled' | 'gstack_skills' | 'jira_enabled' | 'jira_base_url' | 'jira_email' | 'jira_api_token' | 'jira_project_key' | 'notion_enabled' | 'notion_api_key' | 'notion_database_id' | 'github_enabled' | 'github_token' | 'github_owner' | 'github_repo' | 'cli_fallback_chain' | 'default_max_turns'>>): Promise<Project> {
  return put(`/api/projects/${id}`, data);
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


