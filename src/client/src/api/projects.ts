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

export function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'path' | 'default_branch' | 'max_concurrent' | 'claude_model' | 'claude_options' | 'cli_tool' | 'gstack_enabled' | 'gstack_skills' | 'jira_enabled' | 'jira_base_url' | 'jira_email' | 'jira_api_token' | 'jira_project_key'>>): Promise<Project> {
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

export interface ProjectTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_cost: number;
  num_turns: number;
  tasks_with_usage: number;
}

export function getProjectTokenUsage(id: string): Promise<ProjectTokenUsage> {
  return get(`/api/projects/${id}/token-usage`);
}
