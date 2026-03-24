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

export interface Todo {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'merged';
  priority: number;
  branch_name: string | null;
  worktree_path: string | null;
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

export interface TaskLog {
  id: string;
  todo_id: string;
  log_type: 'info' | 'error' | 'output' | 'commit';
  message: string;
  created_at: string;
}
