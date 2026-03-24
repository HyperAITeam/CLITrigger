import { Router, Request, Response } from 'express';
import { getTodosByProjectId, getTodoById } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';
import { orchestrator } from '../services/orchestrator.js';

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

    await orchestrator.startTodo(todo.id);

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

export default router;
