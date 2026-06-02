import { Router, Request, Response } from 'express';
import {
  createPersonalItem,
  getPersonalItems,
  getPersonalItemById,
  updatePersonalItem,
  deletePersonalItem,
  getAllUpcomingSchedules,
  getAllPlannerDueItems,
} from '../db/queries.js';

const router = Router();

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

export default router;
