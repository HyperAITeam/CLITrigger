import { Router, Request, Response } from 'express';
import simpleGit from 'simple-git';
import fs from 'fs';
import { getTaskLogsByTodoId, getTodoById, getTodosByProjectId } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';

interface ChangedFile {
  status: string; // 'A' | 'M' | 'D' | 'R' | 'C' etc.
  file: string;
  renamedFrom?: string;
}

interface CommitInfo {
  hash: string;
  message: string;
  date: string;
}

interface TaskResult {
  duration_seconds: number | null;
  commits: CommitInfo[];
  changed_files: ChangedFile[];
  diff_stats: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
}

const router = Router();

// GET /api/todos/:id/logs - get logs for todo
router.get('/todos/:id/logs', (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const logs = getTaskLogsByTodoId(req.params.id);
    res.json(logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/todos/:id/diff - get git diff for a completed todo's worktree
router.get('/todos/:id/diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    if (!todo.worktree_path) {
      res.status(404).json({ error: 'No worktree path for this todo' });
      return;
    }

    if (!fs.existsSync(todo.worktree_path)) {
      res.status(404).json({ error: 'Worktree directory no longer exists' });
      return;
    }

    const project = getProjectById(todo.project_id);
    const defaultBranch = project?.default_branch || 'main';

    const git = simpleGit(todo.worktree_path);
    const diff = await git.diff([`${defaultBranch}...HEAD`]);
    const diffStat = await git.diff([`${defaultBranch}...HEAD`, '--stat']);

    // Parse stats from diffstat
    let files_changed = 0;
    let insertions = 0;
    let deletions = 0;

    const statMatch = diffStat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    if (statMatch) {
      files_changed = parseInt(statMatch[1], 10) || 0;
      insertions = parseInt(statMatch[2], 10) || 0;
      deletions = parseInt(statMatch[3], 10) || 0;
    }

    res.json({ diff, stats: { files_changed, insertions, deletions } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/todos/:id/result - get detailed task result summary
router.get('/todos/:id/result', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const logs = getTaskLogsByTodoId(req.params.id);

    // Duration: from first log to last log
    let duration_seconds: number | null = null;
    if (logs.length >= 2) {
      const first = new Date(logs[0].created_at).getTime();
      const last = new Date(logs[logs.length - 1].created_at).getTime();
      duration_seconds = Math.round((last - first) / 1000);
    }

    // Commits: extract from commit-type logs
    const commits: CommitInfo[] = logs
      .filter(l => l.log_type === 'commit')
      .map(l => {
        const match = l.message.match(/^\[([a-f0-9]+)\]\s*(.*)/);
        return {
          hash: match ? match[1] : '',
          message: match ? match[2] : l.message,
          date: l.created_at,
        };
      });

    // Changed files & diff stats from git
    let changed_files: ChangedFile[] = [];
    let diff_stats = { files_changed: 0, insertions: 0, deletions: 0 };

    if (todo.worktree_path && fs.existsSync(todo.worktree_path)) {
      const project = getProjectById(todo.project_id);
      const defaultBranch = project?.default_branch || 'main';
      const git = simpleGit(todo.worktree_path);

      try {
        // Get changed files with status
        const nameStatus = await git.diff([`${defaultBranch}...HEAD`, '--name-status']);
        if (nameStatus.trim()) {
          changed_files = nameStatus.trim().split('\n').map(line => {
            const parts = line.split('\t');
            const status = parts[0];
            if (status.startsWith('R') || status.startsWith('C')) {
              return { status: status[0], file: parts[2] || parts[1], renamedFrom: parts[1] };
            }
            return { status: status[0], file: parts[1] || parts[0] };
          });
        }

        // Get diff stats
        const diffStat = await git.diff([`${defaultBranch}...HEAD`, '--stat']);
        const statMatch = diffStat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
        if (statMatch) {
          diff_stats.files_changed = parseInt(statMatch[1], 10) || 0;
          diff_stats.insertions = parseInt(statMatch[2], 10) || 0;
          diff_stats.deletions = parseInt(statMatch[3], 10) || 0;
        }
      } catch {
        // git commands may fail if worktree is in bad state
      }
    }

    const result: TaskResult = { duration_seconds, commits, changed_files, diff_stats };
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/status - get project status summary
router.get('/projects/:id/status', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const todos = getTodosByProjectId(req.params.id);
    const running = todos.filter(t => t.status === 'running').length;
    const completed = todos.filter(t => t.status === 'completed').length;
    res.json({ project_id: req.params.id, total: todos.length, running, completed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
