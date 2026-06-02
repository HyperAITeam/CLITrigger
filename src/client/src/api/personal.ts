import { get, post, put, del } from './client';
import type { PersonalItem, Agenda } from '../types';

export function getPersonalItems(): Promise<PersonalItem[]> {
  return get('/api/personal-items');
}

export function createPersonalItem(data: {
  title: string;
  description?: string;
  due_at?: string | null;
  all_day?: number;
  priority?: number;
  tags?: string | null;
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
    tags?: string | null;
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
