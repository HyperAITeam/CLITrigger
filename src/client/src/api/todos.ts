import { get, post, put, del } from './client';
import type { Todo, TaskLog, DiffResult } from '../types';

export function getTodos(projectId: string): Promise<Todo[]> {
  return get(`/api/projects/${projectId}/todos`);
}

export function createTodo(
  projectId: string,
  data: { title: string; description?: string; priority?: number; cli_tool?: string; cli_model?: string }
): Promise<Todo> {
  return post(`/api/projects/${projectId}/todos`, data);
}

export function updateTodo(
  id: string,
  data: { title?: string; description?: string; priority?: number; cli_tool?: string; cli_model?: string }
): Promise<Todo> {
  return put(`/api/todos/${id}`, data);
}

export function deleteTodo(id: string): Promise<void> {
  return del(`/api/todos/${id}`);
}

export function startTodo(id: string, mode: 'headless' | 'interactive' | 'streaming' = 'headless'): Promise<Todo> {
  return post(`/api/todos/${id}/start`, { mode });
}

export function stopTodo(id: string): Promise<Todo> {
  return post(`/api/todos/${id}/stop`);
}

export function getTodoLogs(id: string): Promise<TaskLog[]> {
  return get(`/api/todos/${id}/logs`);
}

export function getTodoDiff(id: string): Promise<DiffResult> {
  return get(`/api/todos/${id}/diff`);
}

export function mergeTodo(id: string): Promise<{ success: boolean; result?: unknown }> {
  return post(`/api/todos/${id}/merge`);
}

export function cleanupTodo(id: string): Promise<{ success: boolean; worktreeRemoved: boolean; branchDeleted: boolean }> {
  return post(`/api/todos/${id}/cleanup`);
}
