import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import * as queries from '../db/queries.js';
import { getDatabase } from '../db/connection.js';
import { getPlannerImagePaths, cleanupPlannerImages } from './images.js';

const ALLOWED_IMPORT_STATUSES = new Set(['pending', 'in_progress', 'done']);

interface ExportedItem {
  title: string;
  description: string | null;
  tags: string[];
  due_date: string | null;
  status: string;
  priority: number;
}

interface ExportedTag {
  name: string;
  color: string;
}

interface ExportPayload {
  version: number;
  exported_at: string;
  project_name: string;
  items: ExportedItem[];
  tags: ExportedTag[];
}

function sanitizeFilenamePart(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
}

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
    cleanupPlannerImages(req.params.id);
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

// GET /api/projects/:id/planner/export - download planner as JSON
router.get('/projects/:id/planner/export', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const allItems = queries.getPlannerItemsByProjectId(req.params.id);
    const tags = queries.getPlannerTagsByProjectId(req.params.id);

    const items: ExportedItem[] = allItems
      .filter((item) => item.status !== 'moved')
      .map((item) => {
        let parsedTags: string[] = [];
        if (item.tags) {
          try {
            const parsed = JSON.parse(item.tags);
            if (Array.isArray(parsed)) parsedTags = parsed.filter((t) => typeof t === 'string');
          } catch { /* ignore */ }
        }
        return {
          title: item.title,
          description: item.description,
          tags: parsedTags,
          due_date: item.due_date,
          status: item.status,
          priority: item.priority,
        };
      });

    const payload: ExportPayload = {
      version: 1,
      exported_at: new Date().toISOString(),
      project_name: project.name,
      items,
      tags: tags.map((t) => ({ name: t.name, color: t.color })),
    };

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `planner-${sanitizeFilenamePart(project.name)}-${datePart}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/planner/import - import planner JSON
router.post('/projects/:id/planner/import', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const payload = req.body as Partial<ExportPayload> | undefined;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    if (payload.version !== 1) {
      res.status(400).json({ error: `Unsupported version: ${payload.version}` });
      return;
    }
    if (!Array.isArray(payload.items)) {
      res.status(400).json({ error: 'items must be an array' });
      return;
    }

    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];
      if (!item || typeof item.title !== 'string' || !item.title.trim()) {
        res.status(400).json({ error: `items[${i}].title is required` });
        return;
      }
    }

    const existingTagNames = new Set(
      queries.getPlannerTagsByProjectId(req.params.id).map((t) => t.name)
    );

    const db = getDatabase();
    let importedItems = 0;
    let importedTags = 0;

    const runImport = db.transaction(() => {
      if (Array.isArray(payload.tags)) {
        for (const tag of payload.tags) {
          if (!tag || typeof tag.name !== 'string' || !tag.name.trim()) continue;
          if (existingTagNames.has(tag.name)) continue;
          const color = typeof tag.color === 'string' && tag.color ? tag.color : 'blue';
          queries.upsertPlannerTag(req.params.id, tag.name, color);
          existingTagNames.add(tag.name);
          importedTags++;
        }
      }

      for (const item of payload.items!) {
        const tagsArr = Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : [];
        const rawStatus = typeof item.status === 'string' ? item.status : 'pending';
        const status = ALLOWED_IMPORT_STATUSES.has(rawStatus) ? rawStatus : 'pending';
        const priority = typeof item.priority === 'number' ? item.priority : 0;
        const description = typeof item.description === 'string' ? item.description : undefined;
        const dueDate = typeof item.due_date === 'string' ? item.due_date : undefined;

        const created = queries.createPlannerItem(
          req.params.id,
          item.title,
          description,
          tagsArr.length > 0 ? JSON.stringify(tagsArr) : undefined,
          dueDate,
          priority
        );

        if (status !== 'pending') {
          queries.updatePlannerItem(created.id, { status });
        }
        importedItems++;
      }
    });

    runImport();

    res.status(200).json({ imported_items: importedItems, imported_tags: importedTags });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
