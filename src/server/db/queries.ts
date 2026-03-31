import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './connection.js';

// ── Projects ──

export interface Project {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  is_git_repo: number;
  max_concurrent: number;
  claude_model: string | null;
  claude_options: string | null;
  cli_tool: string;
  gstack_enabled: number;
  gstack_skills: string | null;
  jira_enabled: number;
  jira_base_url: string | null;
  jira_email: string | null;
  jira_api_token: string | null;
  jira_project_key: string | null;
  created_at: string;
  updated_at: string;
}

export function createProject(name: string, projectPath: string, defaultBranch = 'main', isGitRepo = 1): Project {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, default_branch, is_git_repo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, projectPath, defaultBranch, isGitRepo, now, now);
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

export function updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'path' | 'default_branch' | 'is_git_repo' | 'max_concurrent' | 'claude_model' | 'claude_options' | 'cli_tool' | 'gstack_enabled' | 'gstack_skills' | 'jira_enabled' | 'jira_base_url' | 'jira_email' | 'jira_api_token' | 'jira_project_key'>>): Project | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.path !== undefined) { fields.push('path = ?'); values.push(updates.path); }
  if (updates.default_branch !== undefined) { fields.push('default_branch = ?'); values.push(updates.default_branch); }
  if (updates.is_git_repo !== undefined) { fields.push('is_git_repo = ?'); values.push(updates.is_git_repo); }
  if (updates.max_concurrent !== undefined) { fields.push('max_concurrent = ?'); values.push(updates.max_concurrent); }
  if (updates.claude_model !== undefined) { fields.push('claude_model = ?'); values.push(updates.claude_model); }
  if (updates.claude_options !== undefined) { fields.push('claude_options = ?'); values.push(updates.claude_options); }
  if (updates.cli_tool !== undefined) { fields.push('cli_tool = ?'); values.push(updates.cli_tool); }
  if (updates.gstack_enabled !== undefined) { fields.push('gstack_enabled = ?'); values.push(updates.gstack_enabled); }
  if (updates.gstack_skills !== undefined) { fields.push('gstack_skills = ?'); values.push(updates.gstack_skills); }
  if (updates.jira_enabled !== undefined) { fields.push('jira_enabled = ?'); values.push(updates.jira_enabled); }
  if (updates.jira_base_url !== undefined) { fields.push('jira_base_url = ?'); values.push(updates.jira_base_url); }
  if (updates.jira_email !== undefined) { fields.push('jira_email = ?'); values.push(updates.jira_email); }
  if (updates.jira_api_token !== undefined) { fields.push('jira_api_token = ?'); values.push(updates.jira_api_token); }
  if (updates.jira_project_key !== undefined) { fields.push('jira_project_key = ?'); values.push(updates.jira_project_key); }

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
  cli_tool: string | null;
  cli_model: string | null;
  schedule_id: string | null;
  images: string | null;
  depends_on: string | null;
  max_turns: number | null;
  token_usage: string | null;
  created_at: string;
  updated_at: string;
}

export function createTodo(projectId: string, title: string, description?: string, priority = 0, cliTool?: string, cliModel?: string, scheduleId?: string, dependsOn?: string, maxTurns?: number): Todo {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO todos (id, project_id, title, description, priority, cli_tool, cli_model, schedule_id, depends_on, max_turns, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, description ?? null, priority, cliTool ?? null, cliModel ?? null, scheduleId ?? null, dependsOn ?? null, maxTurns ?? null, now, now);
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

export function updateTodo(id: string, updates: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'branch_name' | 'worktree_path' | 'process_pid' | 'cli_tool' | 'cli_model' | 'images' | 'depends_on' | 'max_turns' | 'token_usage'>>): Todo | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.branch_name !== undefined) { fields.push('branch_name = ?'); values.push(updates.branch_name); }
  if (updates.worktree_path !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktree_path); }
  if (updates.process_pid !== undefined) { fields.push('process_pid = ?'); values.push(updates.process_pid); }
  if (updates.cli_tool !== undefined) { fields.push('cli_tool = ?'); values.push(updates.cli_tool); }
  if (updates.cli_model !== undefined) { fields.push('cli_model = ?'); values.push(updates.cli_model); }
  if (updates.images !== undefined) { fields.push('images = ?'); values.push(updates.images); }
  if (updates.depends_on !== undefined) { fields.push('depends_on = ?'); values.push(updates.depends_on); }
  if (updates.max_turns !== undefined) { fields.push('max_turns = ?'); values.push(updates.max_turns); }
  if (updates.token_usage !== undefined) { fields.push('token_usage = ?'); values.push(updates.token_usage); }

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

export function deleteTaskLogsByTodoId(todoId: string): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM task_logs WHERE todo_id = ?').run(todoId);
  return result.changes;
}

// ── Pipelines ──

export interface Pipeline {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  current_phase: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  process_pid: number | null;
  created_at: string;
  updated_at: string;
}

export function createPipeline(projectId: string, title: string, description: string): Pipeline {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pipelines (id, project_id, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, description, now, now);
  return getPipelineById(id)!;
}

export function getPipelinesByProjectId(projectId: string): Pipeline[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM pipelines WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Pipeline[];
}

export function getPipelineById(id: string): Pipeline | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as Pipeline | undefined;
}

export function updatePipeline(id: string, updates: Partial<Pick<Pipeline, 'title' | 'description' | 'current_phase' | 'branch_name' | 'worktree_path' | 'process_pid'>>): Pipeline | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.current_phase !== undefined) { fields.push('current_phase = ?'); values.push(updates.current_phase); }
  if (updates.branch_name !== undefined) { fields.push('branch_name = ?'); values.push(updates.branch_name); }
  if (updates.worktree_path !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktree_path); }
  if (updates.process_pid !== undefined) { fields.push('process_pid = ?'); values.push(updates.process_pid); }

  if (fields.length === 0) return getPipelineById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE pipelines SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getPipelineById(id);
}

export function updatePipelineStatus(id: string, status: string): Pipeline | undefined {
  const db = getDatabase();
  db.prepare('UPDATE pipelines SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  return getPipelineById(id);
}

export function getPipelinesByStatus(status: string): Pipeline[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM pipelines WHERE status = ? ORDER BY created_at DESC').all(status) as Pipeline[];
}

export function deletePipeline(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Pipeline Phases ──

export interface PipelinePhase {
  id: string;
  pipeline_id: string;
  phase_type: string;
  phase_order: number;
  status: string;
  output: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function createPipelinePhase(pipelineId: string, phaseType: string, phaseOrder: number): PipelinePhase {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pipeline_phases (id, pipeline_id, phase_type, phase_order, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, pipelineId, phaseType, phaseOrder, now);
  return db.prepare('SELECT * FROM pipeline_phases WHERE id = ?').get(id) as PipelinePhase;
}

export function getPipelinePhases(pipelineId: string): PipelinePhase[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM pipeline_phases WHERE pipeline_id = ? ORDER BY phase_order ASC').all(pipelineId) as PipelinePhase[];
}

export function updatePipelinePhase(id: string, updates: Partial<Pick<PipelinePhase, 'status' | 'output' | 'started_at' | 'completed_at'>>): PipelinePhase | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output); }
  if (updates.started_at !== undefined) { fields.push('started_at = ?'); values.push(updates.started_at); }
  if (updates.completed_at !== undefined) { fields.push('completed_at = ?'); values.push(updates.completed_at); }

  if (fields.length === 0) return undefined;

  values.push(id);
  db.prepare(`UPDATE pipeline_phases SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM pipeline_phases WHERE id = ?').get(id) as PipelinePhase | undefined;
}

// ── Pipeline Logs ──

export interface PipelineLog {
  id: string;
  pipeline_id: string;
  phase_type: string;
  log_type: string;
  message: string;
  created_at: string;
}

export function createPipelineLog(pipelineId: string, phaseType: string, logType: string, message: string): PipelineLog {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pipeline_logs (id, pipeline_id, phase_type, log_type, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, pipelineId, phaseType, logType, message, now);
  return db.prepare('SELECT * FROM pipeline_logs WHERE id = ?').get(id) as PipelineLog;
}

export function getPipelineLogs(pipelineId: string, phaseType?: string): PipelineLog[] {
  const db = getDatabase();
  if (phaseType) {
    return db.prepare('SELECT * FROM pipeline_logs WHERE pipeline_id = ? AND phase_type = ? ORDER BY created_at ASC').all(pipelineId, phaseType) as PipelineLog[];
  }
  return db.prepare('SELECT * FROM pipeline_logs WHERE pipeline_id = ? ORDER BY created_at ASC').all(pipelineId) as PipelineLog[];
}

// ── Schedules ──

export interface Schedule {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  cron_expression: string;
  cli_tool: string | null;
  cli_model: string | null;
  is_active: number;
  skip_if_running: number;
  last_run_at: string | null;
  next_run_at: string | null;
  schedule_type: string;
  run_at: string | null;
  created_at: string;
  updated_at: string;
}

export function createSchedule(
  projectId: string, title: string, description: string | undefined,
  cronExpression: string, cliTool?: string, cliModel?: string, skipIfRunning = 1,
  scheduleType = 'recurring', runAt?: string
): Schedule {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO schedules (id, project_id, title, description, cron_expression, cli_tool, cli_model, skip_if_running, schedule_type, run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, description ?? null, cronExpression, cliTool ?? null, cliModel ?? null, skipIfRunning, scheduleType, runAt ?? null, now, now);
  return getScheduleById(id)!;
}

export function getSchedulesByProjectId(projectId: string): Schedule[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM schedules WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Schedule[];
}

export function getScheduleById(id: string): Schedule | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Schedule | undefined;
}

export function getActiveSchedules(): Schedule[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM schedules WHERE is_active = 1').all() as Schedule[];
}

export function getActiveOnceSchedules(): Schedule[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM schedules WHERE is_active = 1 AND schedule_type = 'once'").all() as Schedule[];
}

export function updateSchedule(id: string, updates: Partial<Pick<Schedule, 'title' | 'description' | 'cron_expression' | 'cli_tool' | 'cli_model' | 'skip_if_running' | 'schedule_type' | 'run_at'>>): Schedule | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.cron_expression !== undefined) { fields.push('cron_expression = ?'); values.push(updates.cron_expression); }
  if (updates.cli_tool !== undefined) { fields.push('cli_tool = ?'); values.push(updates.cli_tool); }
  if (updates.cli_model !== undefined) { fields.push('cli_model = ?'); values.push(updates.cli_model); }
  if (updates.skip_if_running !== undefined) { fields.push('skip_if_running = ?'); values.push(updates.skip_if_running); }
  if (updates.schedule_type !== undefined) { fields.push('schedule_type = ?'); values.push(updates.schedule_type); }
  if (updates.run_at !== undefined) { fields.push('run_at = ?'); values.push(updates.run_at); }

  if (fields.length === 0) return getScheduleById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getScheduleById(id);
}

export function updateScheduleStatus(id: string, isActive: number): Schedule | undefined {
  const db = getDatabase();
  db.prepare('UPDATE schedules SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive, new Date().toISOString(), id);
  return getScheduleById(id);
}

export function updateScheduleLastRun(id: string, lastRunAt: string): void {
  const db = getDatabase();
  db.prepare('UPDATE schedules SET last_run_at = ?, updated_at = ? WHERE id = ?').run(lastRunAt, new Date().toISOString(), id);
}

export function deleteSchedule(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getTodosByScheduleId(scheduleId: string): Todo[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM todos WHERE schedule_id = ? ORDER BY created_at DESC').all(scheduleId) as Todo[];
}

// ── Schedule Runs ──

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  todo_id: string | null;
  status: string;
  skipped_reason: string | null;
  started_at: string;
  completed_at: string | null;
}

export function createScheduleRun(scheduleId: string, todoId: string | null, status: string, skippedReason?: string): ScheduleRun {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO schedule_runs (id, schedule_id, todo_id, status, skipped_reason, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, scheduleId, todoId, status, skippedReason ?? null, now);
  return db.prepare('SELECT * FROM schedule_runs WHERE id = ?').get(id) as ScheduleRun;
}

export function updateScheduleRun(id: string, updates: Partial<Pick<ScheduleRun, 'status' | 'completed_at'>>): ScheduleRun | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.completed_at !== undefined) { fields.push('completed_at = ?'); values.push(updates.completed_at); }

  if (fields.length === 0) return undefined;

  values.push(id);
  db.prepare(`UPDATE schedule_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM schedule_runs WHERE id = ?').get(id) as ScheduleRun | undefined;
}

export function getScheduleRunsByScheduleId(scheduleId: string, limit = 50): ScheduleRun[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?').all(scheduleId, limit) as ScheduleRun[];
}

// ── Cleanup ──

export function cleanOldLogs(daysToKeep: number): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  const taskResult = db.prepare('DELETE FROM task_logs WHERE created_at < ?').run(cutoff);
  const pipelineResult = db.prepare('DELETE FROM pipeline_logs WHERE created_at < ?').run(cutoff);
  return taskResult.changes + pipelineResult.changes;
}
