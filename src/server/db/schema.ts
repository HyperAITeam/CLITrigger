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
      deprecated INTEGER DEFAULT 0,
      last_verified_at DATETIME,
      source TEXT DEFAULT 'seed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(cli_tool, model_value)
    );

    CREATE TABLE IF NOT EXISTS cli_versions (
      cli_tool TEXT PRIMARY KEY,
      last_version TEXT,
      last_synced_at DATETIME
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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      cli_tool TEXT,
      cli_model TEXT,
      process_pid INTEGER,
      branch_name TEXT,
      worktree_path TEXT,
      token_usage TEXT,
      total_cost_usd REAL,
      total_tokens INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      log_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_raw_chunks (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      bytes BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_session_raw_chunks_session ON session_raw_chunks(session_id);

    CREATE TABLE IF NOT EXISTS planner_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      converted_type TEXT,
      converted_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS planner_tags (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'default',
      UNIQUE(project_id, name)
    );

    -- Global (project-agnostic) personal organizer items. Pure notes/agenda
    -- with no CLI execution. start_at NULL = undated backlog memo. Memos span a
    -- date range [start_at, end_at] (day granularity, no time). due_at/all_day
    -- are legacy columns kept only for migration.
    CREATE TABLE IF NOT EXISTS personal_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      due_at TEXT,
      start_at TEXT,
      end_at TEXT,
      all_day INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Global key/value app settings (e.g. the agenda's personal Jira connection).
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      tags TEXT,
      position_x REAL,
      position_y REAL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
      to_node_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL DEFAULT 'related',
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(from_node_id, to_node_id, relation_type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_nodes_project ON memory_nodes(project_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_project ON memory_edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_from ON memory_edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON memory_edges(to_node_id);

    CREATE TABLE IF NOT EXISTS memory_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      source_type TEXT,
      source_id TEXT,
      source_title TEXT,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_memory_logs_project ON memory_logs(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('executable','command','url')),
      target TEXT NOT NULL,
      args TEXT,
      cwd TEXT,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_aliases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command_template TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    { table: 'discussions', column: 'auto_implement', definition: 'INTEGER DEFAULT 0' },
    { table: 'discussions', column: 'implement_agent_id', definition: 'TEXT' },
    // null = inherit project.use_worktree; 0 = run in project root; 1 = isolated worktree
    { table: 'discussions', column: 'use_worktree', definition: 'INTEGER' },
    { table: 'projects', column: 'use_worktree', definition: 'INTEGER DEFAULT 1' },
    { table: 'todos', column: 'execution_mode', definition: 'TEXT' },
    { table: 'projects', column: 'show_token_usage', definition: 'INTEGER DEFAULT 0' },
    { table: 'todos', column: 'round_count', definition: 'INTEGER DEFAULT 1' },
    { table: 'task_logs', column: 'round_number', definition: 'INTEGER DEFAULT 1' },
    { table: 'todos', column: 'total_cost_usd', definition: 'REAL' },
    { table: 'todos', column: 'total_tokens', definition: 'INTEGER' },
    { table: 'todos', column: 'use_worktree', definition: 'INTEGER' },
    { table: 'sessions', column: 'use_worktree', definition: 'INTEGER DEFAULT 0' },
    { table: 'planner_items', column: 'images', definition: 'TEXT' },
    { table: 'cli_models', column: 'deprecated', definition: 'INTEGER DEFAULT 0' },
    { table: 'cli_models', column: 'last_verified_at', definition: 'DATETIME' },
    { table: 'cli_models', column: 'source', definition: "TEXT DEFAULT 'seed'" },
    { table: 'discussion_agents', column: 'can_implement', definition: 'INTEGER DEFAULT 0' },
    { table: 'projects', column: 'npm_auto_install', definition: 'INTEGER DEFAULT 0' },
    { table: 'todos', column: 'summary', definition: 'TEXT' },
    { table: 'todos', column: 'diff_lines', definition: 'INTEGER' },
    { table: 'todos', column: 'diff_files', definition: 'INTEGER' },
    { table: 'planner_items', column: 'source_discussion_id', definition: 'TEXT' },
    { table: 'todos', column: 'memory_inject_mode', definition: "TEXT DEFAULT 'none'" },
    { table: 'todos', column: 'memory_node_ids', definition: 'TEXT' },
    { table: 'discussions', column: 'memory_inject_mode', definition: "TEXT DEFAULT 'none'" },
    { table: 'discussions', column: 'memory_node_ids', definition: 'TEXT' },
    { table: 'sessions', column: 'memory_inject_mode', definition: "TEXT DEFAULT 'none'" },
    { table: 'sessions', column: 'memory_node_ids', definition: 'TEXT' },
    { table: 'projects', column: 'memory_default_mode', definition: "TEXT DEFAULT 'none'" },
    { table: 'projects', column: 'memory_auto_ingest', definition: 'INTEGER DEFAULT 0' },
    { table: 'memory_nodes', column: 'source_type', definition: 'TEXT' },
    { table: 'memory_nodes', column: 'source_id', definition: 'TEXT' },
    { table: 'memory_nodes', column: 'source_path', definition: 'TEXT' },
    { table: 'todos', column: 'memory_raw_file_paths', definition: 'TEXT' },
    { table: 'discussions', column: 'memory_raw_file_paths', definition: 'TEXT' },
    { table: 'sessions', column: 'memory_raw_file_paths', definition: 'TEXT' },
    { table: 'sessions', column: 'tag_id', definition: 'TEXT' },
    { table: 'sessions', column: 'session_alias_id', definition: 'TEXT' },
    { table: 'projects', column: 'vcs_type', definition: 'TEXT' },
    { table: 'projects', column: 'svn_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'projects', column: 'is_svn_wc', definition: 'INTEGER DEFAULT 0' },
    { table: 'projects', column: 'color', definition: 'TEXT' },
    { table: 'projects', column: 'sort_order', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'personal_items', column: 'images', definition: 'TEXT' },
    { table: 'personal_items', column: 'start_at', definition: 'TEXT' },
    { table: 'personal_items', column: 'end_at', definition: 'TEXT' },
  ];

  for (const { table, column, definition } of migrations) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists - ignore
    }
  }

  // Backfill vcs_type from legacy is_git_repo flag. Idempotent — only touches NULL rows.
  try {
    db.prepare(`UPDATE projects SET vcs_type = 'git' WHERE vcs_type IS NULL AND is_git_repo = 1`).run();
  } catch {
    // ignore — column may not exist yet on extremely old DBs that fail the ALTER above
  }

  // Backfill personal_items date range from legacy due_at (date part only —
  // time is dropped). Undated memos keep start_at NULL (stay in the backlog).
  // Idempotent — only touches rows not yet migrated.
  try {
    db.prepare(
      `UPDATE personal_items
         SET start_at = substr(due_at, 1, 10),
             end_at = substr(due_at, 1, 10)
       WHERE start_at IS NULL AND due_at IS NOT NULL`,
    ).run();
  } catch {
    // ignore — columns may not exist on DBs where the ALTER above failed
  }

  // Backfill sort_order for existing rows so projects keep their current
  // created_at DESC order when first migrated. Only runs when every row is
  // still at the default 0 (i.e. the column was just added).
  try {
    const allZero = db.prepare(
      `SELECT COUNT(*) AS n FROM projects WHERE sort_order != 0`
    ).get() as { n: number };
    if (allZero.n === 0) {
      const rows = db.prepare(`SELECT id FROM projects ORDER BY created_at DESC`).all() as { id: string }[];
      const update = db.prepare(`UPDATE projects SET sort_order = ? WHERE id = ?`);
      const backfill = db.transaction(() => {
        rows.forEach((row, idx) => update.run(idx, row.id));
      });
      backfill();
    }
  } catch {
    // ignore — sort_order column may not exist on very old DBs that failed the ALTER above
  }

  // Migrate legacy integration columns to plugin_configs table
  migratePluginConfigs(db);

  // Deduplicate memory_nodes titles within a project, then enforce UNIQUE
  dedupeMemoryNodeTitles(db);
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_nodes_project_title ON memory_nodes(project_id, title)');
  } catch {
    // unique index creation may fail if dedupe missed a corner case; leave index off rather than crash startup
  }

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

/**
 * Suffix duplicate memory node titles within the same project (`-2`, `-3`, ...)
 * so a (project_id, title) UNIQUE index can be enforced. Idempotent.
 */
function dedupeMemoryNodeTitles(db: Database.Database): void {
  const dups = db.prepare(
    `SELECT project_id, title, COUNT(*) as cnt
       FROM memory_nodes
      GROUP BY project_id, title
     HAVING cnt > 1`
  ).all() as Array<{ project_id: string; title: string; cnt: number }>;
  if (dups.length === 0) return;

  const selectGroup = db.prepare(
    'SELECT id FROM memory_nodes WHERE project_id = ? AND title = ? ORDER BY created_at ASC, id ASC'
  );
  const titleExists = db.prepare(
    'SELECT 1 FROM memory_nodes WHERE project_id = ? AND title = ? LIMIT 1'
  );
  const updateTitle = db.prepare(
    'UPDATE memory_nodes SET title = ?, updated_at = ? WHERE id = ?'
  );

  const tx = db.transaction(() => {
    for (const dup of dups) {
      const rows = selectGroup.all(dup.project_id, dup.title) as Array<{ id: string }>;
      // Keep the first row's title; rename the rest with numeric suffixes
      for (let i = 1; i < rows.length; i++) {
        let suffix = i + 1;
        let candidate = `${dup.title}-${suffix}`;
        while (titleExists.get(dup.project_id, candidate)) {
          suffix += 1;
          candidate = `${dup.title}-${suffix}`;
        }
        updateTitle.run(candidate, new Date().toISOString(), rows[i].id);
      }
    }
  });
  tx();
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
