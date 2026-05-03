import { get, put } from './client';

export interface SessionSettings {
  defaultUseWorktree: boolean;
}

export function getSessionSettings(): Promise<SessionSettings> {
  return get('/api/session-settings');
}

export function updateSessionSettings(data: Partial<SessionSettings>): Promise<SessionSettings> {
  return put('/api/session-settings', data);
}
