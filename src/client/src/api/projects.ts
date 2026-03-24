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

export function updateProject(id: string, data: Partial<Pick<Project, 'name' | 'path' | 'default_branch' | 'max_concurrent' | 'claude_model' | 'claude_options'>>): Promise<Project> {
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
