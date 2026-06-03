import { get, post, put, del } from './client';
import type { PersonalItem, PlannerItem, Agenda, JiraAgendaEntry, AgendaJiraConfig, ImageMeta } from '../types';

export function getPersonalItems(): Promise<PersonalItem[]> {
  return get('/api/personal-items');
}

export function createPersonalItem(data: {
  title: string;
  description?: string;
  due_at?: string | null;
  all_day?: number;
  priority?: number;
  tags?: string[] | string | null;
}): Promise<PersonalItem> {
  return post('/api/personal-items', data);
}

export function updatePersonalItem(
  id: string,
  data: {
    title?: string;
    description?: string;
    due_at?: string | null;
    all_day?: number;
    status?: string;
    priority?: number;
    tags?: string[] | string | null;
  }
): Promise<PersonalItem> {
  return put(`/api/personal-items/${id}`, data);
}

export function deletePersonalItem(id: string): Promise<void> {
  return del(`/api/personal-items/${id}`);
}

export function bulkDeletePersonalItems(data: {
  from?: string;
  to?: string;
  done_only?: boolean;
  include_backlog?: boolean;
}): Promise<{ deleted: number }> {
  return post('/api/personal-items/bulk-delete', data);
}

export function uploadPersonalImages(id: string, images: Array<{ name: string; data: string }>): Promise<{ images: ImageMeta[] }> {
  return post(`/api/personal-items/${id}/images`, { images });
}

export function deletePersonalImage(personalItemId: string, imageId: string): Promise<void> {
  return del(`/api/personal-items/${personalItemId}/images/${imageId}`);
}

export function getPersonalImageUrl(personalItemId: string, imageId: string): string {
  return `/api/personal-items/${personalItemId}/images/${imageId}`;
}

export function getAgenda(from: string, to: string): Promise<Agenda> {
  return get(`/api/agenda?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

// ── Jira (global agenda connection) ─────────────────────────────────────────

export function getAgendaJira(from: string, to: string): Promise<{ issues: JiraAgendaEntry[] }> {
  return get(`/api/agenda/jira?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export function getJiraConfig(): Promise<AgendaJiraConfig> {
  return get('/api/agenda/jira-config');
}

export function saveJiraConfig(data: {
  enabled: boolean; base_url: string; email: string; api_token?: string;
  assignee_me?: boolean; include_done?: boolean; projects?: string; extra_jql?: string;
}): Promise<AgendaJiraConfig> {
  return put('/api/agenda/jira-config', data);
}

export function testJiraConfig(): Promise<{ ok: boolean; user?: string; error?: string }> {
  return get('/api/agenda/jira-test');
}

export function importJiraIssue(entry: JiraAgendaEntry): Promise<PersonalItem> {
  return post('/api/agenda/jira/import', { key: entry.key, summary: entry.summary, duedate: entry.duedate, url: entry.url });
}

// ── Move to a project's planner ─────────────────────────────────────────────

export function movePersonalItemToPlanner(id: string, projectId: string): Promise<{ plannerItem: PlannerItem }> {
  return post(`/api/personal-items/${id}/move-to-planner`, { project_id: projectId });
}

export function importJiraIssueToPlanner(entry: JiraAgendaEntry, projectId: string): Promise<{ plannerItem: PlannerItem }> {
  return post('/api/agenda/jira/import-to-planner', {
    project_id: projectId, key: entry.key, summary: entry.summary, duedate: entry.duedate, url: entry.url,
  });
}
