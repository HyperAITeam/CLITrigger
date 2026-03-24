import { Router, Request, Response } from 'express';
import simpleGit from 'simple-git';
import fs from 'fs';
import { getTaskLogsByTodoId, getTodoById, getTodosByProjectId } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';

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
