import { Router, Request, Response, text } from 'express';
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

function sanitizeFilenamePart(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
}

const STATUS_SECTIONS: Array<{ header: string; status: string }> = [
  { header: 'Pending', status: 'pending' },
  { header: 'In Progress', status: 'in_progress' },
  { header: 'Done', status: 'done' },
];

function serializePlannerMarkdown(
  projectName: string,
  exportedAt: string,
  items: ExportedItem[],
  tags: ExportedTag[]
): string {
  const out: string[] = [];
  out.push(`# Planner Export: ${projectName}`);
  out.push('');
  out.push(`> Version 1 · Exported ${exportedAt}`);
  out.push('');

  if (tags.length > 0) {
    out.push('## Tags');
    out.push('');
    for (const tag of tags) {
      out.push(`- \`${tag.name}\` (${tag.color})`);
    }
    out.push('');
  }

  for (const sec of STATUS_SECTIONS) {
    const sectionItems = items.filter((i) => i.status === sec.status);
    if (sectionItems.length === 0) continue;
    out.push(`## ${sec.header}`);
    out.push('');
    for (const item of sectionItems) {
      const checkbox = sec.status === 'done' ? '[x]' : '[ ]';
      const meta: string[] = [];
      if (item.tags.length > 0) meta.push(`tags:${item.tags.join(',')}`);
      meta.push(`priority:${item.priority}`);
      if (item.due_date) meta.push(`due:${item.due_date}`);
      const metaStr = meta.length > 0 ? ` <!-- ${meta.join(' ')} -->` : '';
      const safeTitle = item.title.trim() || '(untitled)';
      out.push(`- ${checkbox} **${safeTitle}**${metaStr}`);
      if (item.description && item.description.trim()) {
        out.push('');
        for (const dline of item.description.split(/\r?\n/)) {
          out.push(`  ${dline}`);
        }
      }
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

interface ParsedMarkdown {
  items: ExportedItem[];
  tags: ExportedTag[];
}

function parsePlannerMarkdown(md: string): ParsedMarkdown {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const result: ParsedMarkdown = { items: [], tags: [] };

  type Section = { header: string; lines: string[] };
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      current = { header: m[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  for (const section of sections) {
    const header = section.header.toLowerCase();

    if (header === 'tags') {
      for (const line of section.lines) {
        const m = line.match(/^-\s+`([^`]+)`\s*\(([^)]+)\)\s*$/);
        if (m) result.tags.push({ name: m[1].trim(), color: m[2].trim() });
      }
      continue;
    }

    let status: string | null = null;
    if (header === 'pending') status = 'pending';
    else if (header === 'in progress') status = 'in_progress';
    else if (header === 'done') status = 'done';
    if (!status) continue;

    let i = 0;
    while (i < section.lines.length) {
      const line = section.lines[i];
      const itemMatch = line.match(/^-\s+\[([ xX])\]\s*(.*)$/);
      if (!itemMatch) { i++; continue; }

      let rest = itemMatch[2];
      let metadata = '';
      const metaMatch = rest.match(/^(.*?)\s*<!--\s*(.*?)\s*-->\s*$/);
      if (metaMatch) {
        rest = metaMatch[1];
        metadata = metaMatch[2];
      }
      rest = rest.trim();
      const boldMatch = rest.match(/^\*\*(.+)\*\*$/);
      if (boldMatch) rest = boldMatch[1].trim();
      const title = rest === '(untitled)' ? '' : rest;

      const item: ExportedItem = {
        title,
        description: null,
        tags: [],
        due_date: null,
        status,
        priority: 0,
      };

      if (metadata) {
        for (const pair of metadata.split(/\s+/)) {
          const idx = pair.indexOf(':');
          if (idx <= 0) continue;
          const key = pair.slice(0, idx);
          const value = pair.slice(idx + 1);
          if (key === 'tags' && value) {
            item.tags = value.split(',').map((s) => s.trim()).filter(Boolean);
          } else if (key === 'priority') {
            const n = parseInt(value, 10);
            if (!isNaN(n)) item.priority = n;
          } else if (key === 'due') {
            item.due_date = value;
          }
        }
      }

      i++;
      const descLines: string[] = [];
      while (i < section.lines.length) {
        const next = section.lines[i];
        if (/^-\s+\[[ xX]\]/.test(next)) break;
        if (next.trim() === '') {
          descLines.push('');
          i++;
          continue;
        }
        if (/^\s{2,}/.test(next)) {
          descLines.push(next.replace(/^ {2}/, ''));
          i++;
        } else {
          break;
        }
      }
      while (descLines.length && descLines[0] === '') descLines.shift();
      while (descLines.length && descLines[descLines.length - 1] === '') descLines.pop();
      if (descLines.length > 0) item.description = descLines.join('\n');

      if (item.title) result.items.push(item);
    }
  }

  return result;
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

    const { title, description, tags, due_date, priority, page_id } = req.body;
    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const item = queries.createPlannerItem(
      req.params.id, title, description, tags, due_date, priority, undefined, page_id
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

// ── Planner Pages (Notion-style free-form documents) ──────────────────────

// GET /api/projects/:id/planner/pages - list pages (metadata only)
router.get('/projects/:id/planner/pages', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(queries.getPlannerPagesByProjectId(req.params.id));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/:id/planner/pages - create page
router.post('/projects/:id/planner/pages', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const page = queries.createPlannerPage(req.params.id, req.body?.title || undefined, req.body?.content);
    res.status(201).json(page);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/planner/pages/:pageId - get full page (with content)
router.get('/planner/pages/:pageId', (req: Request<{ pageId: string }>, res: Response) => {
  try {
    const page = queries.getPlannerPageById(req.params.pageId);
    if (!page) { res.status(404).json({ error: 'Planner page not found' }); return; }
    res.json(page);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/planner/pages/:pageId/items - tasks belonging to this page
router.get('/planner/pages/:pageId/items', (req: Request<{ pageId: string }>, res: Response) => {
  try {
    res.json(queries.getPlannerItemsByPageId(req.params.pageId));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PUT /api/planner/pages/:pageId - update title/content
router.put('/planner/pages/:pageId', (req: Request<{ pageId: string }>, res: Response) => {
  try {
    const existing = queries.getPlannerPageById(req.params.pageId);
    if (!existing) { res.status(404).json({ error: 'Planner page not found' }); return; }
    const { title, content } = req.body;
    res.json(queries.updatePlannerPage(req.params.pageId, { title, content }));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// DELETE /api/planner/pages/:pageId - delete page (cascades its page-owned tasks)
router.delete('/planner/pages/:pageId', (req: Request<{ pageId: string }>, res: Response) => {
  try {
    const existing = queries.getPlannerPageById(req.params.pageId);
    if (!existing) { res.status(404).json({ error: 'Planner page not found' }); return; }
    for (const item of queries.getPlannerItemsByPageId(req.params.pageId)) {
      cleanupPlannerImages(item.id);
      queries.deletePlannerItem(item.id);
    }
    queries.deletePlannerPage(req.params.pageId);
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
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

    // cli_model is no longer accepted — model selection was removed and
    // execution always uses the CLI's default model.
    const { cli_tool, max_turns } = req.body;
    const todo = queries.createTodo(
      item.project_id, item.title, item.description ?? undefined,
      item.priority, cli_tool, undefined, undefined, undefined, max_turns
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

    const { cron_expression, schedule_type, run_at, cli_tool } = req.body;
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
      cli_tool, undefined, 1,
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

// POST /api/planner/:id/convert-to-session - convert to interactive terminal session
router.post('/planner/:id/convert-to-session', (req: Request<{ id: string }>, res: Response) => {
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

    const { cli_tool, use_worktree } = req.body;
    const session = queries.createSession(
      item.project_id, item.title, item.description ?? undefined,
      cli_tool || undefined, undefined, !!use_worktree,
      'none', null, null, null
    );

    const updatedItem = queries.updatePlannerItem(req.params.id, {
      status: 'moved', converted_type: 'session', converted_id: session.id,
    });

    res.status(201).json({ plannerItem: updatedItem, session });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/planner/export - download planner as Markdown
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

    const exportedAt = new Date().toISOString();
    const md = serializePlannerMarkdown(
      project.name,
      exportedAt,
      items,
      tags.map((t) => ({ name: t.name, color: t.color }))
    );

    const datePart = exportedAt.slice(0, 10).replace(/-/g, '');
    const filename = `planner-${sanitizeFilenamePart(project.name)}-${datePart}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(md);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/planner/import - import planner Markdown
const markdownBodyParser = text({
  type: ['text/markdown', 'text/plain', 'text/*', 'application/octet-stream'],
  limit: '50mb',
});

router.post('/projects/:id/planner/import', markdownBodyParser, (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const md = typeof req.body === 'string' ? req.body : '';
    if (!md.trim()) {
      res.status(400).json({ error: 'Empty markdown body' });
      return;
    }

    const parsed = parsePlannerMarkdown(md);
    if (parsed.items.length === 0 && parsed.tags.length === 0) {
      res.status(400).json({ error: 'No planner items or tags found in markdown' });
      return;
    }

    const existingTagNames = new Set(
      queries.getPlannerTagsByProjectId(req.params.id).map((t) => t.name)
    );

    const db = getDatabase();
    let importedItems = 0;
    let importedTags = 0;

    const runImport = db.transaction(() => {
      for (const tag of parsed.tags) {
        if (!tag.name) continue;
        if (existingTagNames.has(tag.name)) continue;
        const color = tag.color || 'blue';
        queries.upsertPlannerTag(req.params.id, tag.name, color);
        existingTagNames.add(tag.name);
        importedTags++;
      }

      for (const item of parsed.items) {
        const status = ALLOWED_IMPORT_STATUSES.has(item.status) ? item.status : 'pending';
        const description = item.description ?? undefined;
        const dueDate = item.due_date ?? undefined;

        const created = queries.createPlannerItem(
          req.params.id,
          item.title,
          description,
          item.tags.length > 0 ? JSON.stringify(item.tags) : undefined,
          dueDate,
          item.priority
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
