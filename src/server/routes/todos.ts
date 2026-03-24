import { Router, Request, Response } from 'express';
import { createTodo, getTodosByProjectId, getTodoById, updateTodo, deleteTodo } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';

const router = Router();

// POST /api/projects/:id/todos - create todo for project
router.post('/projects/:id/todos', (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectId = req.params.id;
    const project = getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { title, description, priority } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const todo = createTodo(projectId, title, description, priority);
    res.status(201).json(todo);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/todos - list todos for project
router.get('/projects/:id/todos', (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectId = req.params.id;
    const project = getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const todos = getTodosByProjectId(projectId);
    res.json(todos);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/todos/:id - update todo
router.put('/todos/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = getTodoById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const { title, description, priority } = req.body;
    const todo = updateTodo(req.params.id, { title, description, priority });
    res.json(todo);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/todos/:id - delete todo
router.delete('/todos/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const deleted = deleteTodo(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
