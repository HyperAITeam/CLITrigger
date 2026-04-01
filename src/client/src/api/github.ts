import { get, post } from './client';

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  user: { login: string; avatar_url: string } | null;
  labels: Array<{ name: string; color: string }>;
  created_at: string;
  updated_at: string;
  comments: number;
  pull_request?: unknown;
}

export interface GitHubIssueListResult {
  items: GitHubIssue[];
  total_count: number;
}

export function testConnection(projectId: string): Promise<{ ok: boolean; name: string; private: boolean }> {
  return get(`/api/github/${projectId}/test`);
}

export function getIssues(projectId: string, params?: { state?: string; page?: number; per_page?: number; labels?: string; search?: string }): Promise<GitHubIssueListResult> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set('state', params.state);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.per_page) qs.set('per_page', String(params.per_page));
  if (params?.labels) qs.set('labels', params.labels);
  if (params?.search) qs.set('search', params.search);
  const q = qs.toString();
  return get(`/api/github/${projectId}/issues${q ? `?${q}` : ''}`);
}

export function getIssue(projectId: string, number: number): Promise<GitHubIssue> {
  return get(`/api/github/${projectId}/issue/${number}`);
}

export function getComments(projectId: string, number: number): Promise<any[]> {
  return get(`/api/github/${projectId}/issue/${number}/comments`);
}

export function createIssue(projectId: string, data: { title: string; body?: string; labels?: string[] }): Promise<GitHubIssue> {
  return post(`/api/github/${projectId}/issues`, data);
}

export function addComment(projectId: string, number: number, body: string): Promise<any> {
  return post(`/api/github/${projectId}/issue/${number}/comment`, { body });
}

export function importIssue(projectId: string, number: number): Promise<{ title: string; description: string; number: number }> {
  return post(`/api/github/${projectId}/import/${number}`);
}
