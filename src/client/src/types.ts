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
  path_exists?: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, any>;
}

export interface NotionQueryResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface GstackSkill {
  id: string;
  name: string;
  description: string;
  descriptionKo: string;
  category: string;
}

export interface ImageMeta {
  id: string;
  filename: string;
  originalName: string;
  size: number;
}

export interface Todo {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'merged';
  priority: number;
  branch_name: string | null;
  worktree_path: string | null;
  cli_tool: string | null;
  cli_model: string | null;
  images: string | null;
  depends_on: string | null;
  max_turns: number | null;
  merged_from_branch: string | null;
  context_switch_count?: number;
  position_x: number | null;
  position_y: number | null;
  created_at: string;
  updated_at: string;
}

export interface DiffResult {
  diff: string;
  stats: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
}

export interface Pipeline {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped' | 'merged';
  current_phase: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelinePhase {
  id: string;
  pipeline_id: string;
  phase_type: 'planning' | 'implementation' | 'review' | 'feedback_impl' | 'documentation';
  phase_order: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface PipelineLog {
  id: string;
  pipeline_id: string;
  phase_type: string;
  log_type: 'info' | 'error' | 'output' | 'commit';
  message: string;
  created_at: string;
}

export interface PipelineWithPhases extends Pipeline {
  phases: PipelinePhase[];
}

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
  schedule_type: 'recurring' | 'once';
  run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  todo_id: string | null;
  status: 'triggered' | 'skipped' | 'completed' | 'failed';
  skipped_reason: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ChangedFile {
  status: string;
  file: string;
  renamedFrom?: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  date: string;
}

export interface TokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  total_cost: number | null;
  duration_ms: number | null;
  num_turns: number | null;
  context_window: number | null;
}

export interface TaskResult {
  duration_seconds: number | null;
  commits: CommitInfo[];
  changed_files: ChangedFile[];
  diff_stats: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
  token_usage: TokenUsage | null;
}

export interface TaskLog {
  id: string;
  todo_id: string;
  log_type: 'info' | 'error' | 'output' | 'commit' | 'input' | 'prompt' | 'warning';
  message: string;
  created_at: string;
}

// ── Discussions ──

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

export interface Discussion {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'merged';
  current_round: number;
  max_rounds: number;
  current_agent_id: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  agent_ids: string;
  auto_implement: number;
  implement_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscussionMessage {
  id: string;
  discussion_id: string;
  agent_id: string;
  round_number: number;
  turn_order: number;
  role: string;
  agent_name: string;
  content: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DiscussionLog {
  id: string;
  discussion_id: string;
  message_id: string | null;
  log_type: 'info' | 'error' | 'output' | 'commit';
  message: string;
  created_at: string;
}

export interface DiscussionWithMessages extends Discussion {
  messages: DiscussionMessage[];
  agents: DiscussionAgent[];
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory?: { colorName: string } };
    assignee: { displayName: string; avatarUrls?: Record<string, string> } | null;
    priority: { name: string; iconUrl?: string } | null;
    issuetype: { name: string; iconUrl?: string };
    created: string;
    updated: string;
    labels: string[];
  };
}

export interface JiraSearchResult {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}
