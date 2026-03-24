import { get, post, put, del } from './client';
import type { Todo, TaskLog } from '../types';

export function getTodos(projectId: string): Promise<Todo[]> {
  return get(`/api/projects/${projectId}/todos`);
}

export function createTodo(
  projectId: string,
  data: { title: string; description?: string; priority?: number }
): Promise<Todo> {
  return post(`/api/projects/${projectId}/todos`, data);
}

export function updateTodo(
  id: string,
  data: { title?: string; description?: string; priority?: number }
): Promise<Todo> {
  return put(`/api/todos/${id}`, data);
}

export function deleteTodo(id: string): Promise<void> {
  return del(`/api/todos/${id}`);
}

export function startTodo(id: string): Promise<void> {
  return post(`/api/todos/${id}/start`);
}

export function stopTodo(id: string): Promise<void> {
  return post(`/api/todos/${id}/stop`);
}

export function getTodoLogs(id: string): Promise<TaskLog[]> {
  return get(`/api/todos/${id}/logs`);
}
