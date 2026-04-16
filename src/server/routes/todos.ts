import { Router, Request, Response } from 'express';
import { createTodo, getTodosByProjectId, getTodoById, updateTodo, deleteTodo } from '../db/queries.js';
import { getProjectById } from '../db/queries.js';
import { validatePromptContent, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '../services/prompt-guard.js';
import { cleanupTodoImages } from './images.js';

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

    const { title, description, priority, cli_tool, cli_model, depends_on, max_turns } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    // Prompt injection detection (warn only, do not block)
    const titleCheck = validatePromptContent(title, MAX_TITLE_LENGTH);
    const descCheck = description ? validatePromptContent(description, MAX_DESCRIPTION_LENGTH) : null;
    for (const w of [...titleCheck.warnings, ...(descCheck?.warnings || [])]) {
      console.warn(`[prompt-guard] Todo "${title}": ${w}`);
    }

    // Validate depends_on if provided
    if (depends_on) {
      const depTodo = getTodoById(depends_on);
      if (!depTodo || depTodo.project_id !== projectId) {
        res.status(400).json({ error: 'Invalid depends_on: task not found in this project' });
        return;
      }
    }

    const parsedMaxTurns = max_turns != null ? parseInt(max_turns, 10) : undefined;
    const todo = createTodo(projectId, title, description, priority, cli_tool, cli_model, undefined, depends_on, parsedMaxTurns || undefined);
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

    const { title, description, priority, cli_tool, cli_model, depends_on, max_turns, position_x, position_y } = req.body;
    const parsedMaxTurns = max_turns !== undefined ? (max_turns != null ? parseInt(max_turns, 10) || null : null) : undefined;
    const todo = updateTodo(req.params.id, { title, description, priority, cli_tool, cli_model, depends_on, position_x, position_y, ...(parsedMaxTurns !== undefined ? { max_turns: parsedMaxTurns } : {}) });
    res.json(todo);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/todos/:id - delete todo
router.delete('/todos/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    if (todo.status === 'running') {
      res.status(400).json({ error: 'Cannot delete a running todo. Stop it first.' });
      return;
    }
    cleanupTodoImages(req.params.id);
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
