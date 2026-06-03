import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import {
  createPersonalItem,
  getPersonalItems,
  getPersonalItemById,
  updatePersonalItem,
  deletePersonalItem,
  getAllUpcomingSchedules,
  getAllPlannerDueItems,
  getAppSetting,
  setAppSetting,
  getProjectById,
  createPlannerItem,
  updatePlannerItem,
} from '../db/queries.js';
import { jiraMyself, jiraSearch, type JiraConn } from '../lib/jira-client.js';
import { cleanupPersonalImages } from './images.js';

const router = Router();

// ── Agenda Jira connection (global, dedicated to "My Schedule") ────────────

const JIRA_KEY = 'agenda.jira';
interface AgendaJira {
  enabled?: boolean; base_url?: string; email?: string; api_token?: string;
  // Import criteria (applied to both the calendar overlay and what can be imported).
  assignee_me?: boolean;   // default true: only issues assigned to me
  include_done?: boolean;  // default false: exclude Done issues
  projects?: string;       // comma/space-separated project keys, e.g. "ABC DEF"
  extra_jql?: string;      // advanced: raw JQL fragment, AND-ed in
}

function readJira(): AgendaJira {
  try { return JSON.parse(getAppSetting(JIRA_KEY) || '{}'); } catch { return {}; }
}
function jiraConn(j: AgendaJira): JiraConn | null {
  if (!j.enabled || !j.base_url || !j.email || !j.api_token) return null;
  return { baseUrl: j.base_url, email: j.email, apiToken: j.api_token };
}

// ── Personal items CRUD (global, no project, no execution) ─────────────────

router.get('/personal-items', (_req: Request, res: Response) => {
  try {
    res.json(getPersonalItems());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/personal-items', (req: Request, res: Response) => {
  try {
    const { title, description, due_at, all_day, priority, tags } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const item = createPersonalItem(
      title.trim(),
      typeof description === 'string' ? description : undefined,
      due_at ?? null,
      all_day === 0 ? 0 : 1,
      Number.isFinite(priority) ? priority : 0,
      tags != null ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : null,
    );
    res.status(201).json(item);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.put('/personal-items/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!getPersonalItemById(id)) return res.status(404).json({ error: 'not found' });
    const { title, description, due_at, all_day, status, priority, tags } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = String(title);
    if (description !== undefined) updates.description = description;
    if (due_at !== undefined) updates.due_at = due_at;
    if (all_day !== undefined) updates.all_day = all_day ? 1 : 0;
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (tags !== undefined) updates.tags = tags != null ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : null;
    res.json(updatePersonalItem(id, updates));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/personal-items/:id', (req: Request, res: Response) => {
  try {
    cleanupPersonalImages(String(req.params.id));
    const ok = deletePersonalItem(String(req.params.id));
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Bulk-delete personal memos for cleanup. Dated memos are matched by [from, to]
// (inclusive, on the date part of due_at); undated backlog memos are only
// touched when include_backlog is set; done_only restricts to completed memos.
router.post('/personal-items/bulk-delete', (req: Request, res: Response) => {
  try {
    const from = typeof req.body?.from === 'string' ? req.body.from.trim() : '';
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    const doneOnly = !!req.body?.done_only;
    const includeBacklog = !!req.body?.include_backlog;
    const matches = (p: { due_at: string | null; status: string }): boolean => {
      if (doneOnly && p.status !== 'done') return false;
      if (!p.due_at) return includeBacklog;
      if (!from || !to) return false;
      const d = p.due_at.slice(0, 10);
      return d >= from && d <= to;
    };
    const targets = getPersonalItems().filter(matches);
    for (const p of targets) {
      cleanupPersonalImages(p.id);
      deletePersonalItem(p.id);
    }
    res.json({ deleted: targets.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Move a personal item into a project's planner (carries over images, tags,
// due date and completion state), then remove the source personal item.
router.post('/personal-items/:id/move-to-planner', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const item = getPersonalItemById(id);
    if (!item) return res.status(404).json({ error: 'not found' });

    const projectId = String(req.body?.project_id ?? '');
    if (!projectId || !getProjectById(projectId)) return res.status(400).json({ error: 'invalid project_id' });

    const dueDate = item.due_at ? item.due_at.slice(0, 10) : undefined;
    const created = createPlannerItem(
      projectId,
      item.title,
      item.description ?? undefined,
      item.tags ?? undefined,
      dueDate,
      item.priority,
    );

    // Carry images over: copy the files and reuse the same images JSON so the
    // image ids/filenames keep resolving under the new planner item.
    if (item.images) {
      try {
        const metas = JSON.parse(item.images) as Array<{ filename: string }>;
        const srcDir = path.resolve(process.cwd(), 'data', 'uploads', 'personal', id);
        const destDir = path.resolve(process.cwd(), 'data', 'uploads', 'planner', created.id);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        for (const m of metas) {
          const src = path.join(srcDir, m.filename);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, m.filename));
        }
        updatePlannerItem(created.id, { images: item.images });
      } catch { /* ignore image copy failure */ }
    }

    if (item.status === 'done') updatePlannerItem(created.id, { status: 'done' });

    cleanupPersonalImages(id);
    deletePersonalItem(id);

    res.status(201).json({ plannerItem: created });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Aggregated agenda (read-only: personal + project schedules + planner) ──

router.get('/agenda', (req: Request, res: Response) => {
  try {
    const from = (req.query.from as string | undefined)?.trim();
    const to = (req.query.to as string | undefined)?.trim();
    const inRange = (iso: string | null): boolean => {
      if (!iso) return false;
      if (from && iso < from) return false;
      if (to && iso > to) return false;
      return true;
    };

    const personal = getPersonalItems().filter((p) => p.due_at && inRange(p.due_at));
    const schedules = getAllUpcomingSchedules().filter((s) => inRange(s.at));
    const planner = getAllPlannerDueItems().filter((p) => inRange(p.due_date));

    res.json({ personal, schedules, planner });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Config (never returns the raw token)
function jiraConfigResponse(j: AgendaJira) {
  return {
    enabled: !!j.enabled,
    base_url: j.base_url || '',
    email: j.email || '',
    hasToken: !!j.api_token,
    assignee_me: j.assignee_me !== false, // default true
    include_done: !!j.include_done,
    projects: j.projects || '',
    extra_jql: j.extra_jql || '',
  };
}

router.get('/agenda/jira-config', (_req: Request, res: Response) => {
  res.json(jiraConfigResponse(readJira()));
});

router.put('/agenda/jira-config', (req: Request, res: Response) => {
  try {
    const { enabled, base_url, email, api_token, assignee_me, include_done, projects, extra_jql } = req.body ?? {};
    const cur = readJira();
    const next: AgendaJira = {
      enabled: !!enabled,
      base_url: typeof base_url === 'string' ? base_url.trim() : cur.base_url,
      email: typeof email === 'string' ? email.trim() : cur.email,
      // Empty/omitted token keeps the existing one.
      api_token: (typeof api_token === 'string' && api_token.length) ? api_token : cur.api_token,
      assignee_me: assignee_me === undefined ? cur.assignee_me : !!assignee_me,
      include_done: include_done === undefined ? cur.include_done : !!include_done,
      projects: typeof projects === 'string' ? projects.trim() : cur.projects,
      extra_jql: typeof extra_jql === 'string' ? extra_jql.trim() : cur.extra_jql,
    };
    setAppSetting(JIRA_KEY, JSON.stringify(next));
    res.json(jiraConfigResponse(next));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/agenda/jira-test', async (_req: Request, res: Response) => {
  const conn = jiraConn(readJira());
  if (!conn) return res.status(400).json({ ok: false, error: 'not configured' });
  try {
    const me = await jiraMyself(conn);
    res.json({ ok: true, user: me.displayName });
  } catch (err: unknown) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Assigned-to-me open issues: due-dated ones in [from, to] plus ones with no
// due date (so they can be listed even when the calendar can't place them).
router.get('/agenda/jira', async (req: Request, res: Response) => {
  const j = readJira();
  const conn = jiraConn(j);
  if (!conn) return res.json({ issues: [] });
  const from = (req.query.from as string | undefined)?.trim();
  const to = (req.query.to as string | undefined)?.trim();
  const range: string[] = [];
  if (from) range.push(`duedate >= "${from}"`);
  if (to) range.push(`duedate <= "${to}"`);
  const inRange = range.length ? `(${range.join(' AND ')})` : 'duedate IS NOT NULL';

  // Build the JQL from the user's criteria (defaults preserve the original
  // "assigned to me, not done" behavior). Undated issues are always pulled too
  // so they can be listed even when the calendar can't place them.
  const parts: string[] = [];
  if (j.assignee_me !== false) parts.push('assignee = currentUser()');
  if (!j.include_done) parts.push('statusCategory != Done');
  if (j.projects && j.projects.trim()) {
    const keys = j.projects.split(/[,\s]+/).filter(Boolean).map((k) => `"${k}"`).join(', ');
    if (keys) parts.push(`project in (${keys})`);
  }
  if (j.extra_jql && j.extra_jql.trim()) parts.push(`(${j.extra_jql.trim()})`);
  parts.push(`(duedate IS EMPTY OR ${inRange})`);
  const jql = `${parts.join(' AND ')} ORDER BY duedate ASC`;
  try {
    const data = await jiraSearch(conn, jql, 'summary,status,duedate', 100);
    const base = conn.baseUrl.replace(/\/+$/, '');
    const issues = data.issues.map((i) => {
      const f = i.fields as { summary?: string; duedate?: string | null; status?: { name?: string } };
      return {
        key: i.key,
        summary: f.summary || i.key,
        status: f.status?.name || '',
        duedate: f.duedate || null,
        url: `${base}/browse/${i.key}`,
      };
    });
    res.json({ issues });
  } catch (err: unknown) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error', issues: [] });
  }
});

// Import a Jira issue as an editable personal memo.
router.post('/agenda/jira/import', (req: Request, res: Response) => {
  try {
    const { key, summary, duedate, url } = req.body ?? {};
    if (typeof summary !== 'string' || !summary.trim()) return res.status(400).json({ error: 'summary is required' });
    const desc = url ? String(url) : (key ? String(key) : undefined);
    const item = createPersonalItem(
      summary.trim(),
      desc,
      typeof duedate === 'string' && duedate ? duedate : null,
      1,
      0,
      JSON.stringify(['jira', ...(key ? [String(key)] : [])]),
    );
    res.status(201).json(item);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Import a Jira issue directly into a project's planner (Jira issue untouched).
router.post('/agenda/jira/import-to-planner', (req: Request, res: Response) => {
  try {
    const { project_id, key, summary, duedate, url } = req.body ?? {};
    const projectId = String(project_id ?? '');
    if (!projectId || !getProjectById(projectId)) return res.status(400).json({ error: 'invalid project_id' });
    if (typeof summary !== 'string' || !summary.trim()) return res.status(400).json({ error: 'summary is required' });

    const desc = url ? String(url) : (key ? String(key) : undefined);
    const tags = JSON.stringify(['jira', ...(key ? [String(key)] : [])]);
    const dueDate = typeof duedate === 'string' && duedate ? duedate.slice(0, 10) : undefined;
    const created = createPlannerItem(projectId, summary.trim(), desc, tags, dueDate, 0);
    res.status(201).json({ plannerItem: created });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
