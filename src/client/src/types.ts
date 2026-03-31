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
  log_type: 'info' | 'error' | 'output' | 'commit' | 'input';
  message: string;
  created_at: string;
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
