import { Router, Request, Response } from 'express';
import simpleGit from 'simple-git';
import { getTodosByProjectId, getTodoById, updateTodoStatus, updateTodo } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';
import { orchestrator } from '../services/orchestrator.js';
import { worktreeManager } from '../services/worktree-manager.js';

const router = Router();

// POST /api/projects/:id/start - start all pending todos for project
router.post('/projects/:id/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await orchestrator.startProject(req.params.id);

    // Re-fetch todos to return current state
    const todos = getTodosByProjectId(req.params.id);
    const running = todos.filter(t => t.status === 'running');
    res.json({ started: running.length, todos: running });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/stop - stop all running todos for project
router.post('/projects/:id/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await orchestrator.stopProject(req.params.id);

    // Re-fetch todos to return current state
    const todos = getTodosByProjectId(req.params.id);
    const stopped = todos.filter(t => t.status === 'stopped');
    res.json({ stopped: stopped.length, todos: stopped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/start - start single todo
router.post('/todos/:id/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const validModes = ['headless', 'interactive', 'streaming'] as const;
    const mode = validModes.includes(req.body.mode) ? req.body.mode : 'headless';
    await orchestrator.startTodo(todo.id, mode);

    // Re-fetch to return current state
    const updated = getTodoById(todo.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/stop - stop single todo
router.post('/todos/:id/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    await orchestrator.stopTodo(todo.id);

    // Re-fetch to return current state
    const updated = getTodoById(todo.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/merge - merge todo branch to main
router.post('/todos/:id/merge', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    if (todo.status !== 'completed') {
      res.status(400).json({ error: 'Can only merge completed todos' });
      return;
    }

    if (!todo.branch_name) {
      res.status(400).json({ error: 'Todo has no branch to merge' });
      return;
    }

    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const git = simpleGit(project.path);
    const defaultBranch = project.default_branch || 'main';

    // Checkout main branch
    await git.checkout(defaultBranch);

    // Attempt merge
    try {
      const mergeResult = await git.merge([todo.branch_name]);
      updateTodoStatus(todo.id, 'merged');

      // Auto-cleanup worktree and branch after successful merge
      if (todo.worktree_path) {
        try {
          await worktreeManager.cleanupWorktree(project.path, todo.worktree_path, todo.branch_name);
          updateTodo(todo.id, { worktree_path: null, branch_name: null });
        } catch {
          // Non-fatal: merge succeeded even if cleanup fails
        }
      }

      res.json({ success: true, result: mergeResult });
    } catch (mergeErr: unknown) {
      // Merge conflict - abort the merge and report
      try {
        await git.merge(['--abort']);
      } catch {
        // May fail if no merge in progress
      }
      const message = mergeErr instanceof Error ? mergeErr.message : 'Merge failed';
      res.status(409).json({ error: 'Merge conflict', details: message });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/cleanup - remove worktree and branch for a todo
router.post('/todos/:id/cleanup', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    if (todo.status === 'running') {
      res.status(400).json({ error: 'Cannot cleanup a running todo. Stop it first.' });
      return;
    }

    const project = getProjectById(todo.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const result = { worktreeRemoved: false, branchDeleted: false };

    if (todo.worktree_path || todo.branch_name) {
      const cleanup = await worktreeManager.cleanupWorktree(
        project.path,
        todo.worktree_path || '',
        todo.branch_name || ''
      );
      result.worktreeRemoved = cleanup.worktreeRemoved;
      result.branchDeleted = cleanup.branchDeleted;

      // Clear worktree info from DB
      updateTodo(todo.id, { worktree_path: null, branch_name: null });
    }

    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
