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
    { table: 'todos', column: 'cli_tool', definition: 'TEXT' },
    { table: 'todos', column: 'cli_model', definition: 'TEXT' },
    { table: 'todos', column: 'schedule_id', definition: 'TEXT' },
    { table: 'todos', column: 'images', definition: 'TEXT' },
    { table: 'todos', column: 'depends_on', definition: 'TEXT' },
    { table: 'todos', column: 'max_turns', definition: 'INTEGER' },
    { table: 'todos', column: 'token_usage', definition: 'TEXT' },
    { table: 'schedules', column: 'schedule_type', definition: "TEXT DEFAULT 'recurring'" },
    { table: 'schedules', column: 'run_at', definition: 'DATETIME' },
  ];

  for (const { table, column, definition } of migrations) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists - ignore
    }
  }

  // Enable foreign keys
  db.pragma('foreign_keys = ON');
}
