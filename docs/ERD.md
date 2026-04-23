# Database ERD

<!-- AUTO-GENERATED FROM src/server/db/schema.ts — DO NOT EDIT MANUALLY -->
<!-- To regenerate: npm run docs:erd -->
<!-- CI verifies this file is in sync: npm run docs:erd:check -->

Source: `src/server/db/schema.ts`
Stats: 16 tables, 191 columns, 13 foreign keys

## Diagram

```mermaid
erDiagram
    projects ||--o{ todos : "project_id"
    todos ||--o{ task_logs : "todo_id"
    projects ||--o{ schedules : "project_id"
    schedules ||--o{ schedule_runs : "schedule_id"
    todos |o--o{ schedule_runs : "todo_id"
    projects ||--o{ discussion_agents : "project_id"
    projects ||--o{ discussions : "project_id"
    discussions ||--o{ discussion_messages : "discussion_id"
    discussions ||--o{ discussion_logs : "discussion_id"
    projects ||--o{ sessions : "project_id"
    sessions ||--o{ session_logs : "session_id"
    projects ||--o{ planner_items : "project_id"
    projects ||--o{ planner_tags : "project_id"

    projects {
        TEXT id PK
        TEXT name
        TEXT path UK
        TEXT default_branch
        INTEGER is_git_repo
        INTEGER max_concurrent
        TEXT claude_model
        TEXT claude_options
        DATETIME created_at
        DATETIME updated_at
        TEXT cli_tool
        INTEGER gstack_enabled
        TEXT gstack_skills
        INTEGER jira_enabled
        TEXT jira_base_url
        TEXT jira_email
        TEXT jira_api_token
        TEXT jira_project_key
        INTEGER notion_enabled
        TEXT notion_api_key
        TEXT notion_database_id
        INTEGER github_enabled
        TEXT github_token
        TEXT github_owner
        TEXT github_repo
        INTEGER default_max_turns
        TEXT cli_fallback_chain
        TEXT sandbox_mode
        INTEGER debug_logging
        INTEGER use_worktree
        INTEGER show_token_usage
        INTEGER npm_auto_install
    }
    todos {
        TEXT id PK
        TEXT project_id FK
        TEXT title
        TEXT description
        TEXT status
        INTEGER priority
        TEXT branch_name
        TEXT worktree_path
        INTEGER process_pid
        DATETIME created_at
        DATETIME updated_at
        TEXT cli_tool
        TEXT cli_model
        TEXT schedule_id
        TEXT images
        TEXT depends_on
        INTEGER max_turns
        TEXT token_usage
        REAL position_x
        REAL position_y
        TEXT merged_from_branch
        INTEGER context_switch_count
        TEXT execution_mode
        INTEGER round_count
        REAL total_cost_usd
        INTEGER total_tokens
        INTEGER use_worktree
    }
    task_logs {
        TEXT id PK
        TEXT todo_id FK
        TEXT log_type
        TEXT message
        DATETIME created_at
        INTEGER round_number
    }
    schedules {
        TEXT id PK
        TEXT project_id FK
        TEXT title
        TEXT description
        TEXT cron_expression
        TEXT cli_tool
        TEXT cli_model
        INTEGER is_active
        INTEGER skip_if_running
        DATETIME last_run_at
        DATETIME next_run_at
        DATETIME created_at
        DATETIME updated_at
        TEXT schedule_type
        DATETIME run_at
    }
    schedule_runs {
        TEXT id PK
        TEXT schedule_id FK
        TEXT todo_id FK
        TEXT status
        TEXT skipped_reason
        DATETIME started_at
        DATETIME completed_at
    }
    cli_models {
        TEXT id PK
        TEXT cli_tool
        TEXT model_value
        TEXT model_label
        INTEGER sort_order
        INTEGER is_default
        INTEGER deprecated
        DATETIME last_verified_at
        TEXT source
        DATETIME created_at
    }
    cli_versions {
        TEXT cli_tool PK
        TEXT last_version
        DATETIME last_synced_at
    }
    plugin_configs {
        TEXT id PK
        TEXT project_id
        TEXT plugin_id
        TEXT config_key
        TEXT config_value
        DATETIME created_at
        DATETIME updated_at
    }
    discussion_agents {
        TEXT id PK
        TEXT project_id FK
        TEXT name
        TEXT role
        TEXT system_prompt
        TEXT cli_tool
        TEXT cli_model
        TEXT avatar_color
        INTEGER sort_order
        DATETIME created_at
        DATETIME updated_at
        INTEGER can_implement
    }
    discussions {
        TEXT id PK
        TEXT project_id FK
        TEXT title
        TEXT description
        TEXT status
        INTEGER current_round
        INTEGER max_rounds
        TEXT current_agent_id
        TEXT branch_name
        TEXT worktree_path
        INTEGER process_pid
        TEXT agent_ids
        DATETIME created_at
        DATETIME updated_at
        INTEGER auto_implement
        TEXT implement_agent_id
    }
    discussion_messages {
        TEXT id PK
        TEXT discussion_id FK
        TEXT agent_id
        INTEGER round_number
        INTEGER turn_order
        TEXT role
        TEXT agent_name
        TEXT content
        TEXT status
        DATETIME started_at
        DATETIME completed_at
        DATETIME created_at
    }
    discussion_logs {
        TEXT id PK
        TEXT discussion_id FK
        TEXT message_id
        TEXT log_type
        TEXT message
        DATETIME created_at
    }
    sessions {
        TEXT id PK
        TEXT project_id FK
        TEXT title
        TEXT description
        TEXT status
        TEXT cli_tool
        TEXT cli_model
        INTEGER process_pid
        TEXT branch_name
        TEXT worktree_path
        TEXT token_usage
        REAL total_cost_usd
        INTEGER total_tokens
        DATETIME created_at
        DATETIME updated_at
        INTEGER use_worktree
    }
    session_logs {
        TEXT id PK
        TEXT session_id FK
        TEXT log_type
        TEXT message
        DATETIME created_at
    }
    planner_items {
        TEXT id PK
        TEXT project_id FK
        TEXT title
        TEXT description
        TEXT tags
        TEXT due_date
        TEXT status
        INTEGER priority
        TEXT converted_type
        TEXT converted_id
        DATETIME created_at
        DATETIME updated_at
        TEXT images
    }
    planner_tags {
        TEXT id PK
        TEXT project_id FK
        TEXT name
        TEXT color
    }
```

## Domain Groupings

- **Todo Execution**: `projects` → `todos` → `task_logs`
- **Scheduling**: `projects` → `schedules` → `schedule_runs` → `todos`
- **Discussion**: `projects` → `discussion_agents` / `discussions` → `discussion_messages` / `discussion_logs`
- **Session**: `projects` → `sessions` → `session_logs`
- **Planner**: `projects` → `planner_items` / `planner_tags`
- **Plugin Config**: `projects` → `plugin_configs` (implicit FK, see notes)
- **CLI Registry**: `cli_models`, `cli_versions` (standalone)

## Notes

- `plugin_configs.project_id` has no SQL `REFERENCES` declaration but conceptually points to `projects.id`. It is a generic key-value table used by the plugin system.
- Relationships: `||--o{` = parent required (ON DELETE CASCADE), `|o--o{` = parent optional (ON DELETE SET NULL).
- Columns added via `ALTER TABLE` migrations in `schema.ts` are merged into their parent tables in declaration order.
- Composite `UNIQUE(...)` constraints are omitted from the diagram; see `schema.ts` for the full definition.
