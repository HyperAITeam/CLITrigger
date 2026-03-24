import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './connection.js';

// ── Projects ──

export interface Project {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  max_concurrent: number;
  claude_model: string | null;
  claude_options: string | null;
  created_at: string;
  updated_at: string;
}

export function createProject(name: string, projectPath: string, defaultBranch = 'main'): Project {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, default_branch, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, projectPath, defaultBranch, now, now);
  return getProjectById(id)!;
}

export function getAllProjects(): Project[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

export function getProjectById(id: string): Project | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'path' | 'default_branch' | 'max_concurrent' | 'claude_model' | 'claude_options'>>): Project | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.path !== undefined) { fields.push('path = ?'); values.push(updates.path); }
  if (updates.default_branch !== undefined) { fields.push('default_branch = ?'); values.push(updates.default_branch); }
  if (updates.max_concurrent !== undefined) { fields.push('max_concurrent = ?'); values.push(updates.max_concurrent); }
  if (updates.claude_model !== undefined) { fields.push('claude_model = ?'); values.push(updates.claude_model); }
  if (updates.claude_options !== undefined) { fields.push('claude_options = ?'); values.push(updates.claude_options); }

  if (fields.length === 0) return getProjectById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProjectById(id);
}

export function deleteProject(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Todos ──

export interface Todo {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  branch_name: string | null;
  worktree_path: string | null;
  process_pid: number | null;
  created_at: string;
  updated_at: string;
}

export function createTodo(projectId: string, title: string, description?: string, priority = 0): Todo {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO todos (id, project_id, title, description, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, description ?? null, priority, now, now);
  return getTodoById(id)!;
}

export function getTodosByProjectId(projectId: string): Todo[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM todos WHERE project_id = ? ORDER BY priority DESC, created_at ASC').all(projectId) as Todo[];
}

export function getTodoById(id: string): Todo | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined;
}

export function updateTodo(id: string, updates: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'branch_name' | 'worktree_path' | 'process_pid'>>): Todo | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.branch_name !== undefined) { fields.push('branch_name = ?'); values.push(updates.branch_name); }
  if (updates.worktree_path !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktree_path); }
  if (updates.process_pid !== undefined) { fields.push('process_pid = ?'); values.push(updates.process_pid); }

  if (fields.length === 0) return getTodoById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getTodoById(id);
}

export function updateTodoStatus(id: string, status: string): Todo | undefined {
  const db = getDatabase();
  db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  return getTodoById(id);
}

export function getTodosByStatus(status: string): Todo[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM todos WHERE status = ? ORDER BY priority DESC, created_at ASC').all(status) as Todo[];
}

export function deleteTodo(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Task Logs ──

export interface TaskLog {
  id: string;
  todo_id: string;
  log_type: string;
  message: string;
  created_at: string;
}

export function createTaskLog(todoId: string, logType: string, message: string): TaskLog {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO task_logs (id, todo_id, log_type, message, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, todoId, logType, message, now);
  return db.prepare('SELECT * FROM task_logs WHERE id = ?').get(id) as TaskLog;
}

export function getTaskLogsByTodoId(todoId: string): TaskLog[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM task_logs WHERE todo_id = ? ORDER BY created_at ASC').all(todoId) as TaskLog[];
}

// ── Cleanup ──

export function cleanOldLogs(daysToKeep: number): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM task_logs WHERE created_at < ?').run(cutoff);
  return result.changes;
}
