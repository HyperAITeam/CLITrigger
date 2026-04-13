import { get, post, put, del } from './client';
import type { Todo, TaskLog, DiffResult, TaskResult, ImageMeta } from '../types';

export function getTodos(projectId: string): Promise<Todo[]> {
  return get(`/api/projects/${projectId}/todos`);
}

export function createTodo(
  projectId: string,
  data: { title: string; description?: string; priority?: number; cli_tool?: string; cli_model?: string; depends_on?: string; max_turns?: number | null }
): Promise<Todo> {
  return post(`/api/projects/${projectId}/todos`, data);
}

export function updateTodo(
  id: string,
  data: { title?: string; description?: string; priority?: number; cli_tool?: string; cli_model?: string; depends_on?: string | null; max_turns?: number | null; position_x?: number; position_y?: number }
): Promise<Todo> {
  return put(`/api/todos/${id}`, data);
}

export function deleteTodo(id: string): Promise<void> {
  return del(`/api/todos/${id}`);
}

export function startTodo(id: string, mode: 'headless' | 'interactive' | 'verbose' = 'headless'): Promise<Todo> {
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

export function getTodoResult(id: string): Promise<TaskResult> {
  return get(`/api/todos/${id}/result`);
}

export function mergeTodo(id: string): Promise<{ success: boolean; result?: unknown }> {
  return post(`/api/todos/${id}/merge`);
}

export function mergeChain(id: string): Promise<{ success: boolean; result?: unknown; mergedCount: number; mergedIds: string[] }> {
  return post(`/api/todos/${id}/merge-chain`);
}

export function cleanupTodo(id: string): Promise<{ success: boolean; worktreeRemoved: boolean; branchDeleted: boolean }> {
  return post(`/api/todos/${id}/cleanup`);
}

export function retryTodo(id: string, mode: 'headless' | 'interactive' | 'verbose' = 'headless'): Promise<Todo> {
  return post(`/api/todos/${id}/retry`, { mode });
}

export function continueTodo(id: string, prompt: string, mode: 'headless' | 'interactive' | 'verbose' = 'headless'): Promise<Todo> {
  return post(`/api/todos/${id}/continue`, { prompt, mode });
}

export function uploadTodoImages(id: string, images: Array<{ name: string; data: string }>): Promise<{ images: ImageMeta[] }> {
  return post(`/api/todos/${id}/images`, { images });
}

export function deleteTodoImage(todoId: string, imageId: string): Promise<void> {
  return del(`/api/todos/${todoId}/images/${imageId}`);
}

export function getTodoImageUrl(todoId: string, imageId: string): string {
  return `/api/todos/${todoId}/images/${imageId}`;
}
