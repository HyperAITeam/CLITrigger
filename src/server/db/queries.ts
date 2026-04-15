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
  notion_enabled: number;
  notion_api_key: string | null;
  notion_database_id: string | null;
  github_enabled: number;
  github_token: string | null;
  github_owner: string | null;
  github_repo: string | null;
  cli_fallback_chain: string | null;
  default_max_turns: number | null;
  sandbox_mode: string;
  debug_logging: number;
  use_worktree: number;
  show_token_usage: number;
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

export function updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'path' | 'default_branch' | 'is_git_repo' | 'max_concurrent' | 'claude_model' | 'claude_options' | 'cli_tool' | 'gstack_enabled' | 'gstack_skills' | 'jira_enabled' | 'jira_base_url' | 'jira_email' | 'jira_api_token' | 'jira_project_key' | 'notion_enabled' | 'notion_api_key' | 'notion_database_id' | 'github_enabled' | 'github_token' | 'github_owner' | 'github_repo' | 'cli_fallback_chain' | 'default_max_turns' | 'sandbox_mode' | 'debug_logging' | 'use_worktree' | 'show_token_usage'>>): Project | undefined {
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
  if (updates.notion_enabled !== undefined) { fields.push('notion_enabled = ?'); values.push(updates.notion_enabled); }
  if (updates.notion_api_key !== undefined) { fields.push('notion_api_key = ?'); values.push(updates.notion_api_key); }
  if (updates.notion_database_id !== undefined) { fields.push('notion_database_id = ?'); values.push(updates.notion_database_id); }
  if (updates.github_enabled !== undefined) { fields.push('github_enabled = ?'); values.push(updates.github_enabled); }
  if (updates.github_token !== undefined) { fields.push('github_token = ?'); values.push(updates.github_token); }
  if (updates.github_owner !== undefined) { fields.push('github_owner = ?'); values.push(updates.github_owner); }
  if (updates.github_repo !== undefined) { fields.push('github_repo = ?'); values.push(updates.github_repo); }
  if (updates.cli_fallback_chain !== undefined) { fields.push('cli_fallback_chain = ?'); values.push(updates.cli_fallback_chain); }
  if (updates.default_max_turns !== undefined) { fields.push('default_max_turns = ?'); values.push(updates.default_max_turns); }
  if (updates.sandbox_mode !== undefined) { fields.push('sandbox_mode = ?'); values.push(updates.sandbox_mode); }
  if (updates.debug_logging !== undefined) { fields.push('debug_logging = ?'); values.push(updates.debug_logging); }
  if (updates.use_worktree !== undefined) { fields.push('use_worktree = ?'); values.push(updates.use_worktree); }
  if (updates.show_token_usage !== undefined) { fields.push('show_token_usage = ?'); values.push(updates.show_token_usage); }

  if (fields.length === 0) return getProjectById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProjectById(id);
}

export function syncProjectCliDefaults(
  projectId: string,
  previousTool: string | null,
  previousModel: string | null,
  nextTool: string | null,
  nextModel: string | null
): { updatedTodos: number; updatedSchedules: number } {
  const db = getDatabase();
  const now = new Date().toISOString();

  const todoResult = db.prepare(
    `UPDATE todos
     SET cli_tool = ?, cli_model = ?, updated_at = ?
     WHERE project_id = ?
       AND status != 'running'
       AND ((cli_tool = ?) OR (cli_tool IS NULL AND ? IS NULL))
       AND ((cli_model = ?) OR (cli_model IS NULL AND ? IS NULL))`
  ).run(nextTool, nextModel, now, projectId, previousTool, previousTool, previousModel, previousModel);

  const scheduleResult = db.prepare(
    `UPDATE schedules
     SET cli_tool = ?, cli_model = ?, updated_at = ?
     WHERE project_id = ?
       AND ((cli_tool = ?) OR (cli_tool IS NULL AND ? IS NULL))
       AND ((cli_model = ?) OR (cli_model IS NULL AND ? IS NULL))`
  ).run(nextTool, nextModel, now, projectId, previousTool, previousTool, previousModel, previousModel);

  return {
    updatedTodos: todoResult.changes,
    updatedSchedules: scheduleResult.changes,
  };
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
  merged_from_branch: string | null;
  context_switch_count: number;
  execution_mode: string | null;
  round_count: number;
  total_cost_usd: number | null;
  total_tokens: number | null;
  position_x: number | null;
  position_y: number | null;
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

export function updateTodo(id: string, updates: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'branch_name' | 'worktree_path' | 'process_pid' | 'cli_tool' | 'cli_model' | 'images' | 'depends_on' | 'max_turns' | 'token_usage' | 'position_x' | 'position_y' | 'merged_from_branch' | 'context_switch_count' | 'execution_mode' | 'round_count' | 'total_cost_usd' | 'total_tokens'>>): Todo | undefined {
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
  if (updates.position_x !== undefined) { fields.push('position_x = ?'); values.push(updates.position_x); }
  if (updates.position_y !== undefined) { fields.push('position_y = ?'); values.push(updates.position_y); }
  if (updates.merged_from_branch !== undefined) { fields.push('merged_from_branch = ?'); values.push(updates.merged_from_branch); }
  if (updates.context_switch_count !== undefined) { fields.push('context_switch_count = ?'); values.push(updates.context_switch_count); }
  if (updates.execution_mode !== undefined) { fields.push('execution_mode = ?'); values.push(updates.execution_mode); }
  if (updates.round_count !== undefined) { fields.push('round_count = ?'); values.push(updates.round_count); }
  if (updates.total_cost_usd !== undefined) { fields.push('total_cost_usd = ?'); values.push(updates.total_cost_usd); }
  if (updates.total_tokens !== undefined) { fields.push('total_tokens = ?'); values.push(updates.total_tokens); }

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
  round_number: number;
  created_at: string;
}

export function createTaskLog(todoId: string, logType: string, message: string, roundNumber = 1): TaskLog {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO task_logs (id, todo_id, log_type, message, round_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, todoId, logType, message, roundNumber, now);
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

export function getScheduleRunsByScheduleId(scheduleId: string, limit = 50): (ScheduleRun & { todo_branch_name: string | null; todo_worktree_path: string | null; todo_status: string | null })[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT sr.*, t.branch_name AS todo_branch_name, t.worktree_path AS todo_worktree_path, t.status AS todo_status
    FROM schedule_runs sr
    LEFT JOIN todos t ON sr.todo_id = t.id
    WHERE sr.schedule_id = ?
    ORDER BY sr.started_at DESC LIMIT ?
  `).all(scheduleId, limit) as (ScheduleRun & { todo_branch_name: string | null; todo_worktree_path: string | null; todo_status: string | null })[];
}

// ── CLI Models ──

export interface CliModel {
  id: string;
  cli_tool: string;
  model_value: string;
  model_label: string;
  sort_order: number;
  is_default: number;
  created_at: string;
}

export function getModelsByTool(tool: string): CliModel[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM cli_models WHERE cli_tool = ? ORDER BY sort_order ASC').all(tool) as CliModel[];
}

export function getAllModels(): Record<string, CliModel[]> {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM cli_models ORDER BY cli_tool ASC, sort_order ASC').all() as CliModel[];
  const grouped: Record<string, CliModel[]> = {};
  for (const row of rows) {
    if (!grouped[row.cli_tool]) grouped[row.cli_tool] = [];
    grouped[row.cli_tool].push(row);
  }
  return grouped;
}

export function addModel(cliTool: string, modelValue: string, modelLabel: string): CliModel {
  const db = getDatabase();
  const id = uuidv4();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM cli_models WHERE cli_tool = ?').get(cliTool) as { max_order: number | null };
  const sortOrder = (maxOrder.max_order ?? -1) + 1;
  db.prepare(
    `INSERT INTO cli_models (id, cli_tool, model_value, model_label, sort_order, is_default) VALUES (?, ?, ?, ?, ?, 0)`
  ).run(id, cliTool, modelValue, modelLabel, sortOrder);
  return db.prepare('SELECT * FROM cli_models WHERE id = ?').get(id) as CliModel;
}

export function removeModel(id: string): boolean {
  const db = getDatabase();
  const model = db.prepare('SELECT * FROM cli_models WHERE id = ?').get(id) as CliModel | undefined;
  if (!model || model.is_default === 1) return false;
  const result = db.prepare('DELETE FROM cli_models WHERE id = ? AND is_default = 0').run(id);
  return result.changes > 0;
}

export function isModelSupported(cliTool: string, modelValue: string): boolean {
  const db = getDatabase();
  const row = db.prepare('SELECT 1 FROM cli_models WHERE cli_tool = ? AND model_value = ?').get(cliTool, modelValue);
  return !!row;
}

// ── CLI Fallback ──

export function getNextFallbackCli(projectId: string, currentCliTool: string): { cliTool: string; cliModel: null } | null {
  const project = getProjectById(projectId);
  if (!project?.cli_fallback_chain) return null;

  let chain: string[];
  try {
    chain = JSON.parse(project.cli_fallback_chain);
  } catch {
    return null;
  }

  if (!Array.isArray(chain) || chain.length === 0) return null;

  const currentIndex = chain.indexOf(currentCliTool);
  if (currentIndex === -1 || currentIndex >= chain.length - 1) return null;

  return { cliTool: chain[currentIndex + 1], cliModel: null };
}

// ── Plugin Configs ──

export function getPluginConfig(projectId: string, pluginId: string): Record<string, string | null> | null {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT config_key, config_value FROM plugin_configs WHERE project_id = ? AND plugin_id = ?'
  ).all(projectId, pluginId) as Array<{ config_key: string; config_value: string | null }>;

  if (rows.length === 0) return null;

  const config: Record<string, string | null> = {};
  for (const row of rows) {
    config[row.config_key] = row.config_value;
  }
  return config;
}

export function setPluginConfigs(projectId: string, pluginId: string, configs: Record<string, string | null>): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO plugin_configs (id, project_id, plugin_id, config_key, config_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, plugin_id, config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = excluded.updated_at`
  );

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(configs)) {
      upsert.run(uuidv4(), projectId, pluginId, key, value, now, now);
    }
  });

  transaction();
}

export function isPluginEnabled(projectId: string, pluginId: string): boolean {
  const db = getDatabase();
  const row = db.prepare(
    "SELECT config_value FROM plugin_configs WHERE project_id = ? AND plugin_id = ? AND config_key = 'enabled'"
  ).get(projectId, pluginId) as { config_value: string | null } | undefined;
  return row?.config_value === '1';
}

export function deletePluginConfigs(projectId: string, pluginId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM plugin_configs WHERE project_id = ? AND plugin_id = ?').run(projectId, pluginId);
}

// ── Discussion Agents ──

export interface DiscussionAgent {
  id: string;
  project_id: string;
  name: string;
  role: string;
  system_prompt: string;
  cli_tool: string | null;
  cli_model: string | null;
  avatar_color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function createDiscussionAgent(
  projectId: string, name: string, role: string, systemPrompt: string,
  cliTool?: string, cliModel?: string, avatarColor?: string
): DiscussionAgent {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM discussion_agents WHERE project_id = ?').get(projectId) as { max_order: number | null };
  const sortOrder = (maxOrder.max_order ?? -1) + 1;
  db.prepare(
    `INSERT INTO discussion_agents (id, project_id, name, role, system_prompt, cli_tool, cli_model, avatar_color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, name, role, systemPrompt, cliTool ?? null, cliModel ?? null, avatarColor ?? null, sortOrder, now, now);
  return getDiscussionAgentById(id)!;
}

export function getDiscussionAgentsByProjectId(projectId: string): DiscussionAgent[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM discussion_agents WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as DiscussionAgent[];
}

export function getDiscussionAgentById(id: string): DiscussionAgent | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM discussion_agents WHERE id = ?').get(id) as DiscussionAgent | undefined;
}

export function updateDiscussionAgent(id: string, updates: Partial<Pick<DiscussionAgent, 'name' | 'role' | 'system_prompt' | 'cli_tool' | 'cli_model' | 'avatar_color' | 'sort_order'>>): DiscussionAgent | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.role !== undefined) { fields.push('role = ?'); values.push(updates.role); }
  if (updates.system_prompt !== undefined) { fields.push('system_prompt = ?'); values.push(updates.system_prompt); }
  if (updates.cli_tool !== undefined) { fields.push('cli_tool = ?'); values.push(updates.cli_tool); }
  if (updates.cli_model !== undefined) { fields.push('cli_model = ?'); values.push(updates.cli_model); }
  if (updates.avatar_color !== undefined) { fields.push('avatar_color = ?'); values.push(updates.avatar_color); }
  if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }

  if (fields.length === 0) return getDiscussionAgentById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE discussion_agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getDiscussionAgentById(id);
}

export function deleteDiscussionAgent(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM discussion_agents WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Discussions ──

export interface Discussion {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  current_round: number;
  max_rounds: number;
  current_agent_id: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  process_pid: number | null;
  agent_ids: string;
  auto_implement: number;
  implement_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export function createDiscussion(
  projectId: string, title: string, description: string, agentIds: string[], maxRounds = 3,
  autoImplement = false, implementAgentId?: string
): Discussion {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO discussions (id, project_id, title, description, max_rounds, agent_ids, auto_implement, implement_agent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, description, maxRounds, JSON.stringify(agentIds), autoImplement ? 1 : 0, implementAgentId || null, now, now);
  return getDiscussionById(id)!;
}

export function getDiscussionsByProjectId(projectId: string): Discussion[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM discussions WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Discussion[];
}

export function getDiscussionById(id: string): Discussion | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM discussions WHERE id = ?').get(id) as Discussion | undefined;
}

export function updateDiscussion(id: string, updates: Partial<Pick<Discussion, 'title' | 'description' | 'current_round' | 'max_rounds' | 'current_agent_id' | 'branch_name' | 'worktree_path' | 'process_pid' | 'agent_ids' | 'auto_implement' | 'implement_agent_id'>>): Discussion | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.current_round !== undefined) { fields.push('current_round = ?'); values.push(updates.current_round); }
  if (updates.max_rounds !== undefined) { fields.push('max_rounds = ?'); values.push(updates.max_rounds); }
  if (updates.current_agent_id !== undefined) { fields.push('current_agent_id = ?'); values.push(updates.current_agent_id); }
  if (updates.branch_name !== undefined) { fields.push('branch_name = ?'); values.push(updates.branch_name); }
  if (updates.worktree_path !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktree_path); }
  if (updates.process_pid !== undefined) { fields.push('process_pid = ?'); values.push(updates.process_pid); }
  if (updates.agent_ids !== undefined) { fields.push('agent_ids = ?'); values.push(updates.agent_ids); }
  if (updates.auto_implement !== undefined) { fields.push('auto_implement = ?'); values.push(updates.auto_implement); }
  if (updates.implement_agent_id !== undefined) { fields.push('implement_agent_id = ?'); values.push(updates.implement_agent_id); }

  if (fields.length === 0) return getDiscussionById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE discussions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getDiscussionById(id);
}

export function updateDiscussionStatus(id: string, status: string): Discussion | undefined {
  const db = getDatabase();
  db.prepare('UPDATE discussions SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  return getDiscussionById(id);
}

export function getDiscussionsByStatus(status: string): Discussion[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM discussions WHERE status = ? ORDER BY created_at DESC').all(status) as Discussion[];
}

export function deleteDiscussion(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM discussions WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Discussion Messages ──

export interface DiscussionMessage {
  id: string;
  discussion_id: string;
  agent_id: string;
  round_number: number;
  turn_order: number;
  role: string;
  agent_name: string;
  content: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function createDiscussionMessage(
  discussionId: string, agentId: string, roundNumber: number, turnOrder: number,
  role: string, agentName: string
): DiscussionMessage {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO discussion_messages (id, discussion_id, agent_id, round_number, turn_order, role, agent_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, discussionId, agentId, roundNumber, turnOrder, role, agentName, now);
  return db.prepare('SELECT * FROM discussion_messages WHERE id = ?').get(id) as DiscussionMessage;
}

export function getDiscussionMessages(discussionId: string): DiscussionMessage[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM discussion_messages WHERE discussion_id = ? ORDER BY round_number ASC, turn_order ASC').all(discussionId) as DiscussionMessage[];
}

export function getDiscussionMessageById(id: string): DiscussionMessage | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM discussion_messages WHERE id = ?').get(id) as DiscussionMessage | undefined;
}

export function updateDiscussionMessage(id: string, updates: Partial<Pick<DiscussionMessage, 'content' | 'status' | 'started_at' | 'completed_at'>>): DiscussionMessage | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.started_at !== undefined) { fields.push('started_at = ?'); values.push(updates.started_at); }
  if (updates.completed_at !== undefined) { fields.push('completed_at = ?'); values.push(updates.completed_at); }

  if (fields.length === 0) return undefined;

  values.push(id);
  db.prepare(`UPDATE discussion_messages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM discussion_messages WHERE id = ?').get(id) as DiscussionMessage | undefined;
}

// ── Discussion Logs ──

export interface DiscussionLog {
  id: string;
  discussion_id: string;
  message_id: string | null;
  log_type: string;
  message: string;
  created_at: string;
}

export function createDiscussionLog(discussionId: string, messageId: string | null, logType: string, message: string): DiscussionLog {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO discussion_logs (id, discussion_id, message_id, log_type, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, discussionId, messageId, logType, message, now);
  return db.prepare('SELECT * FROM discussion_logs WHERE id = ?').get(id) as DiscussionLog;
}

export function getDiscussionLogs(discussionId: string, messageId?: string): DiscussionLog[] {
  const db = getDatabase();
  if (messageId) {
    return db.prepare('SELECT * FROM discussion_logs WHERE discussion_id = ? AND message_id = ? ORDER BY created_at ASC').all(discussionId, messageId) as DiscussionLog[];
  }
  return db.prepare('SELECT * FROM discussion_logs WHERE discussion_id = ? ORDER BY created_at ASC').all(discussionId) as DiscussionLog[];
}

export function deleteDiscussionLogs(discussionId: string): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM discussion_logs WHERE discussion_id = ?').run(discussionId);
  return result.changes;
}

// ── Sessions ──

export interface Session {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  cli_tool: string | null;
  cli_model: string | null;
  process_pid: number | null;
  branch_name: string | null;
  worktree_path: string | null;
  use_worktree: number;
  token_usage: string | null;
  total_cost_usd: number | null;
  total_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export function createSession(projectId: string, title: string, description?: string, cliTool?: string, cliModel?: string, useWorktree?: boolean): Session {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, description, cli_tool, cli_model, use_worktree, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, description ?? null, cliTool ?? null, cliModel ?? null, useWorktree ? 1 : 0, now, now);
  return getSessionById(id)!;
}

export function getSessionsByProjectId(projectId: string): Session[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Session[];
}

export function getSessionById(id: string): Session | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
}

export function updateSession(id: string, updates: Partial<Pick<Session, 'title' | 'description' | 'cli_tool' | 'cli_model' | 'process_pid' | 'branch_name' | 'worktree_path' | 'use_worktree' | 'token_usage' | 'total_cost_usd' | 'total_tokens'>>): Session | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.cli_tool !== undefined) { fields.push('cli_tool = ?'); values.push(updates.cli_tool); }
  if (updates.cli_model !== undefined) { fields.push('cli_model = ?'); values.push(updates.cli_model); }
  if (updates.process_pid !== undefined) { fields.push('process_pid = ?'); values.push(updates.process_pid); }
  if (updates.branch_name !== undefined) { fields.push('branch_name = ?'); values.push(updates.branch_name); }
  if (updates.worktree_path !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktree_path); }
  if (updates.use_worktree !== undefined) { fields.push('use_worktree = ?'); values.push(updates.use_worktree); }
  if (updates.token_usage !== undefined) { fields.push('token_usage = ?'); values.push(updates.token_usage); }
  if (updates.total_cost_usd !== undefined) { fields.push('total_cost_usd = ?'); values.push(updates.total_cost_usd); }
  if (updates.total_tokens !== undefined) { fields.push('total_tokens = ?'); values.push(updates.total_tokens); }

  if (fields.length === 0) return getSessionById(id);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getSessionById(id);
}

export function updateSessionStatus(id: string, status: string): Session | undefined {
  const db = getDatabase();
  db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  return getSessionById(id);
}

export function getSessionsByStatus(status: string): Session[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY created_at DESC').all(status) as Session[];
}

export function deleteSession(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Session Logs ──

export interface SessionLog {
  id: string;
  session_id: string;
  log_type: string;
  message: string;
  created_at: string;
}

export function createSessionLog(sessionId: string, logType: string, message: string): SessionLog {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO session_logs (id, session_id, log_type, message, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, sessionId, logType, message, now);
  return db.prepare('SELECT * FROM session_logs WHERE id = ?').get(id) as SessionLog;
}

export function getSessionLogsBySessionId(sessionId: string): SessionLog[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM session_logs WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as SessionLog[];
}

export function deleteSessionLogsBySessionId(sessionId: string): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM session_logs WHERE session_id = ?').run(sessionId);
  return result.changes;
}

// ── Cleanup ──

export function cleanOldLogs(daysToKeep: number): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  const taskResult = db.prepare('DELETE FROM task_logs WHERE created_at < ?').run(cutoff);
  const discussionResult = db.prepare('DELETE FROM discussion_logs WHERE created_at < ?').run(cutoff);
  const sessionResult = db.prepare('DELETE FROM session_logs WHERE created_at < ?').run(cutoff);
  return taskResult.changes + discussionResult.changes + sessionResult.changes;
}
