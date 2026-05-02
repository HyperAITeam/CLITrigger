import { get, post, put } from './client';

export interface AuthStatus {
  authenticated: boolean;
  authRequired: boolean;
  setupRequired: boolean;
}

export function login(password: string): Promise<{ success: true }> {
  return post('/api/auth/login', { password });
}

export function logout(): Promise<void> {
  return post('/api/auth/logout');
}

export function getAuthStatus(): Promise<AuthStatus> {
  return get('/api/auth/status');
}

export function setupPassword(password: string, confirmPassword: string): Promise<{ success: true }> {
  return post('/api/auth/setup', { password, confirmPassword });
}

export function changePassword(
  oldPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<{ success: true }> {
  return put('/api/auth/password', { oldPassword, newPassword, confirmPassword });
}
