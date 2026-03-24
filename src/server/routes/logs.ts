import { Router, Request, Response } from 'express';
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

// GET /api/projects/:id/status - get project status summary
router.get('/projects/:id/status', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const todos = getTodosByProjectId(req.params.id);
    const summary: Record<string, number> = {};
    for (const todo of todos) {
      summary[todo.status] = (summary[todo.status] || 0) + 1;
    }
    res.json({ project_id: req.params.id, total: todos.length, by_status: summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
