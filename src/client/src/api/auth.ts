import { get, post } from './client';

export function login(password: string): Promise<{ message: string }> {
  return post('/api/auth/login', { password });
}

export function logout(): Promise<void> {
  return post('/api/auth/logout');
}

export function getAuthStatus(): Promise<{ authenticated: boolean; authRequired: boolean }> {
  return get('/api/auth/status');
}
