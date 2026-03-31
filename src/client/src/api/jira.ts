import { get, post } from './client';
import type { JiraSearchResult } from '../types';

export function testConnection(projectId: string): Promise<{ ok: boolean; user: string; email: string }> {
  return get(`/api/jira/${projectId}/test`);
}

export function getIssues(projectId: string, params?: { status?: string; search?: string; maxResults?: number; startAt?: number }): Promise<JiraSearchResult> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  if (params?.maxResults) query.set('maxResults', String(params.maxResults));
  if (params?.startAt) query.set('startAt', String(params.startAt));
  const qs = query.toString();
  return get(`/api/jira/${projectId}/issues${qs ? `?${qs}` : ''}`);
}

export function getIssue(projectId: string, issueKey: string): Promise<any> {
  return get(`/api/jira/${projectId}/issue/${issueKey}`);
}

export function getTransitions(projectId: string, issueKey: string): Promise<{ transitions: Array<{ id: string; name: string }> }> {
  return get(`/api/jira/${projectId}/issue/${issueKey}/transitions`);
}

export function transitionIssue(projectId: string, issueKey: string, transitionId: string): Promise<{ ok: boolean }> {
  return post(`/api/jira/${projectId}/issue/${issueKey}/transition`, { transitionId });
}

export function addComment(projectId: string, issueKey: string, body: string): Promise<any> {
  return post(`/api/jira/${projectId}/issue/${issueKey}/comment`, { body });
}

export function createIssue(projectId: string, data: { summary: string; description?: string; issueType?: string }): Promise<{ key: string; id: string }> {
  return post(`/api/jira/${projectId}/issues`, data);
}

export function importIssue(projectId: string, issueKey: string): Promise<{ title: string; description: string; issueKey: string }> {
  return post(`/api/jira/${projectId}/import/${issueKey}`);
}

export function getStatuses(projectId: string): Promise<string[]> {
  return get(`/api/jira/${projectId}/statuses`);
}
