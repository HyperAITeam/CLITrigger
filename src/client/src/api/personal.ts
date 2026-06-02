import { get, post, put, del } from './client';
import type { PersonalItem, Agenda, JiraAgendaEntry, AgendaJiraConfig } from '../types';

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

export function saveJiraConfig(data: { enabled: boolean; base_url: string; email: string; api_token?: string }): Promise<AgendaJiraConfig> {
  return put('/api/agenda/jira-config', data);
}

export function testJiraConfig(): Promise<{ ok: boolean; user?: string; error?: string }> {
  return get('/api/agenda/jira-test');
}

export function importJiraIssue(entry: JiraAgendaEntry): Promise<PersonalItem> {
  return post('/api/agenda/jira/import', { key: entry.key, summary: entry.summary, duedate: entry.duedate, url: entry.url });
}
