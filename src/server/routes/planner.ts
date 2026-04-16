import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import * as queries from '../db/queries.js';
import { getPlannerImagePaths } from './images.js';

const router = Router();

// GET /api/projects/:id/planner - list planner items
router.get('/projects/:id/planner', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const items = queries.getPlannerItemsByProjectId(req.params.id);
    res.json(items);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/planner/tags - get unique tags
router.get('/projects/:id/planner/tags', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const tags = queries.getPlannerTagsByProjectId(req.params.id);
    res.json(tags);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/projects/:id/planner/tags/:name - update tag (color or rename)
router.put('/projects/:id/planner/tags/:name', (req: Request<{ id: string; name: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const { color, new_name } = req.body;
    const tagName = decodeURIComponent(req.params.name);

    if (new_name && new_name !== tagName) {
      queries.renamePlannerTag(req.params.id, tagName, new_name);
    }
    if (color) {
      queries.upsertPlannerTag(req.params.id, new_name || tagName, color);
    }

    const tags = queries.getPlannerTagsByProjectId(req.params.id);
    res.json(tags);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/projects/:id/planner/tags/:name - delete tag from all items
router.delete('/projects/:id/planner/tags/:name', (req: Request<{ id: string; name: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    queries.deletePlannerTag(req.params.id, decodeURIComponent(req.params.name));
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/planner - create planner item
router.post('/projects/:id/planner', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { title, description, tags, due_date, priority } = req.body;
    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const item = queries.createPlannerItem(
      req.params.id, title, description, tags, due_date, priority
    );
    res.status(201).json(item);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/planner/:id - get single item
router.get('/planner/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const item = queries.getPlannerItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }
    res.json(item);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/planner/:id - update item
router.put('/planner/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = queries.getPlannerItemById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }

    const { title, description, tags, due_date, status, priority } = req.body;
    const updated = queries.updatePlannerItem(req.params.id, {
      title, description, tags, due_date, status, priority,
    });
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/planner/:id - delete item
router.delete('/planner/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = queries.getPlannerItemById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }
    queries.deletePlannerItem(req.params.id);
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/planner/:id/convert-to-todo - convert to TODO
router.post('/planner/:id/convert-to-todo', (req: Request<{ id: string }>, res: Response) => {
  try {
    const item = queries.getPlannerItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }
    if (item.status === 'moved') {
      res.status(400).json({ error: 'Item already converted' });
      return;
    }

    const { cli_tool, cli_model, max_turns } = req.body;
    const todo = queries.createTodo(
      item.project_id, item.title, item.description ?? undefined,
      item.priority, cli_tool, cli_model, undefined, undefined, max_turns
    );

    // Copy planner images to todo
    if (item.images) {
      const plannerImagePaths = getPlannerImagePaths(item.id);
      if (plannerImagePaths.length > 0) {
        const todoDir = path.resolve(process.cwd(), 'data', 'uploads', todo.id);
        if (!fs.existsSync(todoDir)) fs.mkdirSync(todoDir, { recursive: true });
        for (const { filename, filePath } of plannerImagePaths) {
          fs.copyFileSync(filePath, path.join(todoDir, filename));
        }
        queries.updateTodo(todo.id, { images: item.images });
      }
    }

    const updatedItem = queries.updatePlannerItem(req.params.id, {
      status: 'moved', converted_type: 'todo', converted_id: todo.id,
    });

    const updatedTodo = queries.getTodoById(todo.id)!;
    res.status(201).json({ plannerItem: updatedItem, todo: updatedTodo });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/planner/:id/convert-to-schedule - convert to schedule
router.post('/planner/:id/convert-to-schedule', (req: Request<{ id: string }>, res: Response) => {
  try {
    const item = queries.getPlannerItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }
    if (item.status === 'moved') {
      res.status(400).json({ error: 'Item already converted' });
      return;
    }

    const { cron_expression, schedule_type, run_at, cli_tool, cli_model } = req.body;
    const isOnce = schedule_type === 'once';

    if (isOnce && !run_at) {
      res.status(400).json({ error: 'run_at is required for one-time schedules' });
      return;
    }
    if (!isOnce && !cron_expression) {
      res.status(400).json({ error: 'cron_expression is required for recurring schedules' });
      return;
    }

    const schedule = queries.createSchedule(
      item.project_id, item.title, item.description ?? undefined,
      isOnce ? '* * * * *' : cron_expression,
      cli_tool, cli_model, 1,
      isOnce ? 'once' : 'recurring',
      isOnce ? run_at : undefined
    );

    const updatedItem = queries.updatePlannerItem(req.params.id, {
      status: 'moved', converted_type: 'schedule', converted_id: schedule.id,
    });

    res.status(201).json({ plannerItem: updatedItem, schedule });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
