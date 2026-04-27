import { Router, Request, Response } from 'express';
import { getReviewQueue, getReviewSummary, type ReviewQueueRow } from '../db/queries.js';

const router = Router();

const DEFAULT_STATUSES = ['completed', 'failed', 'stopped'];
const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 30; // cap at 30 days

interface ReviewItem extends ReviewQueueRow {
  risk: 'low' | 'medium' | 'high';
}

function classifyRisk(row: ReviewQueueRow): 'low' | 'medium' | 'high' {
  if (row.status === 'failed') return 'high';
  const lines = row.diff_lines ?? 0;
  if (lines > 300) return 'high';
  if (lines >= 50) return 'medium';
  return 'low';
}

function parseSinceQuery(req: Request): string {
  const sinceParam = (req.query.since as string | undefined)?.trim();
  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const hoursParam = parseInt((req.query.hours as string | undefined) ?? '', 10);
  const hours = Number.isFinite(hoursParam) && hoursParam > 0
    ? Math.min(hoursParam, MAX_WINDOW_HOURS)
    : DEFAULT_WINDOW_HOURS;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function parseStatuses(req: Request): string[] {
  const raw = (req.query.statuses as string | undefined)?.trim();
  if (!raw) return DEFAULT_STATUSES;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : DEFAULT_STATUSES;
}

router.get('/queue', (req: Request, res: Response) => {
  try {
    const since = parseSinceQuery(req);
    const statuses = parseStatuses(req);
    const rows = getReviewQueue(since, statuses);
    const items: ReviewItem[] = rows.map((row) => ({ ...row, risk: classifyRisk(row) }));
    res.json({ since, statuses, items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/summary', (req: Request, res: Response) => {
  try {
    const since = parseSinceQuery(req);
    const statuses = parseStatuses(req);
    const summary = getReviewSummary(since, statuses);
    res.json({ since, statuses, ...summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
