import { get, post, put, del } from './client';
import type { SessionTag } from '../types';

export function getSessionTags(): Promise<SessionTag[]> {
  return get('/api/session-tags');
}

export function createSessionTag(data: { name: string; color: string }): Promise<SessionTag> {
  return post('/api/session-tags', data);
}

export function updateSessionTag(
  id: string,
  data: { name?: string; color?: string; sort_order?: number },
): Promise<SessionTag> {
  return put(`/api/session-tags/${id}`, data);
}

export function deleteSessionTag(id: string): Promise<void> {
  return del(`/api/session-tags/${id}`);
}
