import { Router, Request, Response } from 'express';
import { getTodosByProjectId, getTodoById, updateTodoStatus } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';

const router = Router();

// POST /api/projects/:id/start - start all pending todos for project
router.post('/projects/:id/start', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const todos = getTodosByProjectId(req.params.id);
    const pending = todos.filter(t => t.status === 'pending');
    // TODO: Wire up orchestrator to actually spawn Claude CLI processes
    const updated = pending.map(t => updateTodoStatus(t.id, 'running'));
    res.json({ started: updated.length, todos: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/stop - stop all running todos for project
router.post('/projects/:id/stop', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const todos = getTodosByProjectId(req.params.id);
    const running = todos.filter(t => t.status === 'running');
    // TODO: Wire up orchestrator to actually kill processes
    const updated = running.map(t => updateTodoStatus(t.id, 'stopped'));
    res.json({ stopped: updated.length, todos: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/start - start single todo
router.post('/todos/:id/start', (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    // TODO: Wire up orchestrator to actually spawn Claude CLI process
    const updated = updateTodoStatus(todo.id, 'running');
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/todos/:id/stop - stop single todo
router.post('/todos/:id/stop', (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    // TODO: Wire up orchestrator to actually kill process
    const updated = updateTodoStatus(todo.id, 'stopped');
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
