import { get, post, put, del } from './client';
import type { Session, SessionLog } from '../types';

export function getSessions(projectId: string): Promise<Session[]> {
  return get(`/api/projects/${projectId}/sessions`);
}

export function createSession(
  projectId: string,
  data: { title: string; description?: string; cli_tool?: string; cli_model?: string }
): Promise<Session> {
  return post(`/api/projects/${projectId}/sessions`, data);
}

export function updateSession(
  id: string,
  data: { title?: string; description?: string; cli_tool?: string; cli_model?: string }
): Promise<Session> {
  return put(`/api/sessions/${id}`, data);
}

export function deleteSession(id: string): Promise<void> {
  return del(`/api/sessions/${id}`);
}

export function startSession(id: string): Promise<Session> {
  return post(`/api/sessions/${id}/start`);
}

export function stopSession(id: string): Promise<Session> {
  return post(`/api/sessions/${id}/stop`);
}

export function getSessionLogs(id: string): Promise<SessionLog[]> {
  return get(`/api/sessions/${id}/logs`);
}
