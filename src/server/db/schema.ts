import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

export function initDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      default_branch TEXT DEFAULT 'main',
      is_git_repo INTEGER DEFAULT 1,
      max_concurrent INTEGER DEFAULT 3,
      claude_model TEXT,
      claude_options TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      branch_name TEXT,
      worktree_path TEXT,
      process_pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      log_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      current_phase TEXT,
      branch_name TEXT,
      worktree_path TEXT,
      process_pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_phases (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      phase_type TEXT NOT NULL,
      phase_order INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      output TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_logs (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      phase_type TEXT NOT NULL,
      log_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      cron_expression TEXT NOT NULL,
      cli_tool TEXT,
      cli_model TEXT,
      is_active INTEGER DEFAULT 1,
      skip_if_running INTEGER DEFAULT 1,
      last_run_at DATETIME,
      next_run_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedule_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'triggered',
      skipped_reason TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS cli_models (
      id TEXT PRIMARY KEY,
      cli_tool TEXT NOT NULL,
      model_value TEXT NOT NULL,
      model_label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(cli_tool, model_value)
    );

    CREATE TABLE IF NOT EXISTS plugin_configs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      config_key TEXT NOT NULL,
      config_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, plugin_id, config_key)
    );

    CREATE TABLE IF NOT EXISTS discussion_agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      cli_tool TEXT,
      cli_model TEXT,
      avatar_color TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discussions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      current_round INTEGER DEFAULT 0,
      max_rounds INTEGER DEFAULT 3,
      current_agent_id TEXT,
      branch_name TEXT,
      worktree_path TEXT,
      process_pid INTEGER,
      agent_ids TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discussion_messages (
      id TEXT PRIMARY KEY,
      discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      turn_order INTEGER NOT NULL,
      role TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      content TEXT,
      status TEXT DEFAULT 'pending',
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discussion_logs (
      id TEXT PRIMARY KEY,
      discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
      message_id TEXT,
      log_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Backwards-compatible migration: add new columns to existing DBs
  const migrations = [
    { table: 'projects', column: 'max_concurrent', definition: 'INTEGER DEFAULT 3' },
    { table: 'projects', column: 'claude_model', definition: 'TEXT' },
    { table: 'projects', column: 'claude_options', definition: 'TEXT' },
    { table: 'projects', column: 'is_git_repo', definition: 'INTEGER DEFAULT 1' },
    { table: 'projects', column: 'cli_tool', definition: "TEXT DEFAULT 'claude'" },
    { table: 'projects', column: 'gstack_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'projects', column: 'gstack_skills', definition: 'TEXT' },
    { table: 'projects', column: 'jira_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'projects', column: 'jira_base_url', definition: 'TEXT' },
    { table: 'projects', column: 'jira_email', definition: 'TEXT' },
    { table: 'projects', column: 'jira_api_token', definition: 'TEXT' },
    { table: 'projects', column: 'jira_project_key', definition: 'TEXT' },
    { table: 'projects', column: 'notion_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'projects', column: 'notion_api_key', definition: 'TEXT' },
    { table: 'projects', column: 'notion_database_id', definition: 'TEXT' },
    { table: 'projects', column: 'github_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'projects', column: 'github_token', definition: 'TEXT' },
    { table: 'projects', column: 'github_owner', definition: 'TEXT' },
    { table: 'projects', column: 'github_repo', definition: 'TEXT' },
    { table: 'projects', column: 'default_max_turns', definition: 'INTEGER' },
    { table: 'todos', column: 'cli_tool', definition: 'TEXT' },
    { table: 'todos', column: 'cli_model', definition: 'TEXT' },
    { table: 'todos', column: 'schedule_id', definition: 'TEXT' },
    { table: 'todos', column: 'images', definition: 'TEXT' },
    { table: 'todos', column: 'depends_on', definition: 'TEXT' },
    { table: 'todos', column: 'max_turns', definition: 'INTEGER' },
    { table: 'todos', column: 'token_usage', definition: 'TEXT' },
    { table: 'todos', column: 'position_x', definition: 'REAL' },
    { table: 'todos', column: 'position_y', definition: 'REAL' },
    { table: 'todos', column: 'merged_from_branch', definition: 'TEXT' },
    { table: 'projects', column: 'cli_fallback_chain', definition: 'TEXT' },
    { table: 'todos', column: 'context_switch_count', definition: 'INTEGER DEFAULT 0' },
    { table: 'schedules', column: 'schedule_type', definition: "TEXT DEFAULT 'recurring'" },
    { table: 'schedules', column: 'run_at', definition: 'DATETIME' },
    { table: 'projects', column: 'sandbox_mode', definition: "TEXT DEFAULT 'strict'" },
    { table: 'projects', column: 'debug_logging', definition: 'INTEGER DEFAULT 0' },
  ];

  for (const { table, column, definition } of migrations) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists - ignore
    }
  }

  // Migrate legacy integration columns to plugin_configs table
  migratePluginConfigs(db);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Seed cli_models if empty
  const modelCount = db.prepare('SELECT COUNT(*) as count FROM cli_models').get() as { count: number };
  if (modelCount.count === 0) {
    seedCliModels(db);
  }
}

/**
 * Migrate legacy per-integration columns from projects table
 * to the generic plugin_configs table. Idempotent — skips if
 * plugin_configs already has data for a given project+plugin.
 */
function migratePluginConfigs(db: Database.Database): void {
  const projects = db.prepare('SELECT * FROM projects').all() as any[];
  if (projects.length === 0) return;

  // Check if any migration has already happened
  const existing = db.prepare('SELECT COUNT(*) as count FROM plugin_configs').get() as { count: number };
  if (existing.count > 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO plugin_configs (id, project_id, plugin_id, config_key, config_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const pluginMappings: Array<{ pluginId: string; columns: Array<{ from: string; to: string }> }> = [
    {
      pluginId: 'jira',
      columns: [
        { from: 'jira_enabled', to: 'enabled' },
        { from: 'jira_base_url', to: 'base_url' },
        { from: 'jira_email', to: 'email' },
        { from: 'jira_api_token', to: 'api_token' },
        { from: 'jira_project_key', to: 'project_key' },
      ],
    },
    {
      pluginId: 'github',
      columns: [
        { from: 'github_enabled', to: 'enabled' },
        { from: 'github_token', to: 'token' },
        { from: 'github_owner', to: 'owner' },
        { from: 'github_repo', to: 'repo' },
      ],
    },
    {
      pluginId: 'notion',
      columns: [
        { from: 'notion_enabled', to: 'enabled' },
        { from: 'notion_api_key', to: 'api_key' },
        { from: 'notion_database_id', to: 'database_id' },
      ],
    },
    {
      pluginId: 'gstack',
      columns: [
        { from: 'gstack_enabled', to: 'enabled' },
        { from: 'gstack_skills', to: 'skills' },
      ],
    },
  ];

  const now = new Date().toISOString();
  const migrate = db.transaction(() => {
    for (const project of projects) {
      for (const mapping of pluginMappings) {
        for (const col of mapping.columns) {
          const value = project[col.from];
          if (value !== undefined && value !== null) {
            insert.run(randomUUID(), project.id, mapping.pluginId, col.to, String(value), now, now);
          }
        }
      }
    }
  });

  migrate();
}

function seedCliModels(db: Database.Database): void {
  const seed = db.prepare(
    `INSERT INTO cli_models (id, cli_tool, model_value, model_label, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const models = [
    // Claude
    ['claude', '', 'Default', 0, 1],
    ['claude', 'claude-sonnet-4-6', 'Claude Sonnet 4.6', 1, 0],
    ['claude', 'claude-opus-4-6', 'Claude Opus 4.6', 2, 0],
    ['claude', 'claude-haiku-4-5', 'Claude Haiku 4.5', 3, 0],
    // Gemini
    ['gemini', '', 'Default (Gemini 2.5 Pro)', 0, 1],
    // Codex
    ['codex', '', 'Default', 0, 1],
    ['codex', 'gpt-4.1', 'GPT-4.1', 1, 0],
    ['codex', 'gpt-4.1-mini', 'GPT-4.1 Mini', 2, 0],
    ['codex', 'gpt-4.1-nano', 'GPT-4.1 Nano', 3, 0],
    ['codex', 'o3', 'o3', 4, 0],
    ['codex', 'o4-mini', 'o4-mini', 5, 0],
  ];

  for (const [tool, value, label, order, isDefault] of models) {
    seed.run(randomUUID(), tool, value, label, order, isDefault);
  }
}
