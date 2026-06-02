import { Router, Request, Response } from 'express';
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
} from '../db/queries.js';
import { jiraMyself, jiraSearch, type JiraConn } from '../lib/jira-client.js';

const router = Router();

// ── Agenda Jira connection (global, dedicated to "My Schedule") ────────────

const JIRA_KEY = 'agenda.jira';
interface AgendaJira { enabled?: boolean; base_url?: string; email?: string; api_token?: string; }

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
    const ok = deletePersonalItem(String(req.params.id));
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
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
router.get('/agenda/jira-config', (_req: Request, res: Response) => {
  const j = readJira();
  res.json({ enabled: !!j.enabled, base_url: j.base_url || '', email: j.email || '', hasToken: !!j.api_token });
});

router.put('/agenda/jira-config', (req: Request, res: Response) => {
  try {
    const { enabled, base_url, email, api_token } = req.body ?? {};
    const cur = readJira();
    const next: AgendaJira = {
      enabled: !!enabled,
      base_url: typeof base_url === 'string' ? base_url.trim() : cur.base_url,
      email: typeof email === 'string' ? email.trim() : cur.email,
      // Empty/omitted token keeps the existing one.
      api_token: (typeof api_token === 'string' && api_token.length) ? api_token : cur.api_token,
    };
    setAppSetting(JIRA_KEY, JSON.stringify(next));
    res.json({ enabled: !!next.enabled, base_url: next.base_url || '', email: next.email || '', hasToken: !!next.api_token });
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

// Assigned-to-me issues with a due date in [from, to].
router.get('/agenda/jira', async (req: Request, res: Response) => {
  const conn = jiraConn(readJira());
  if (!conn) return res.json({ issues: [] });
  const from = (req.query.from as string | undefined)?.trim();
  const to = (req.query.to as string | undefined)?.trim();
  const clauses = ['assignee = currentUser()', 'duedate IS NOT NULL'];
  if (from) clauses.push(`duedate >= "${from}"`);
  if (to) clauses.push(`duedate <= "${to}"`);
  const jql = `${clauses.join(' AND ')} ORDER BY duedate ASC`;
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

export default router;
