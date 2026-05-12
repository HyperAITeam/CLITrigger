import { get, post, put, del } from './client';
import type { SessionAlias } from '../types';

export function getSessionAliases(): Promise<SessionAlias[]> {
  return get('/api/session-aliases');
}

export function createSessionAlias(data: { name: string; command_template: string }): Promise<SessionAlias> {
  return post('/api/session-aliases', data);
}

export function updateSessionAlias(
  id: string,
  data: { name?: string; command_template?: string; sort_order?: number },
): Promise<SessionAlias> {
  return put(`/api/session-aliases/${id}`, data);
}

export function deleteSessionAlias(id: string): Promise<void> {
  return del(`/api/session-aliases/${id}`);
}
