import fs from 'fs';
import { Router, Request, Response } from 'express';
import { getReviewQueue, getReviewSummary, getTodoById, getProjectById, type ReviewQueueRow } from '../db/queries.js';
import { createGit } from '../lib/git.js';

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

interface DiffFile {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
  status: string;
}

function parseNumstat(raw: string): Array<{ path: string; insertions: number; deletions: number; binary: boolean }> {
  const out: Array<{ path: string; insertions: number; deletions: number; binary: boolean }> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const [insRaw, delRaw, ...pathParts] = parts;
    const path = pathParts.join('\t');
    const binary = insRaw === '-' || delRaw === '-';
    out.push({
      path,
      insertions: binary ? 0 : parseInt(insRaw, 10) || 0,
      deletions: binary ? 0 : parseInt(delRaw, 10) || 0,
      binary,
    });
  }
  return out;
}

function parseNameStatus(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const code = parts[0];
    // With -M0 we don't expect R/C, but be defensive: rename emits old + new path.
    const path = parts[parts.length - 1];
    map.set(path, code.charAt(0));
  }
  return map;
}

async function listDiffFiles(git: ReturnType<typeof createGit>, range: string): Promise<DiffFile[]> {
  // -M0 disables rename detection so each rename surfaces as A + D, keeping path strings concrete.
  const [numstat, nameStatus] = await Promise.all([
    git.diff([range, '-M0', '--numstat']),
    git.diff([range, '-M0', '--name-status']),
  ]);
  const statusMap = parseNameStatus(nameStatus);
  return parseNumstat(numstat).map((f) => ({
    ...f,
    status: statusMap.get(f.path) || 'M',
  }));
}

type DiffContext = {
  ok: true;
  gitDir: string;
  range: string;
  defaultBranch: string;
};

type DiffContextErr = {
  ok: false;
  reason: 'todo-not-found' | 'no-branch' | 'branch-missing';
};

async function resolveDiffContext(todoId: string): Promise<DiffContext | DiffContextErr> {
  const todo = getTodoById(todoId);
  if (!todo) return { ok: false, reason: 'todo-not-found' };
  const project = getProjectById(todo.project_id);
  if (!project) return { ok: false, reason: 'todo-not-found' };

  const defaultBranch = project.default_branch || 'main';

  // Prefer the worktree as the git dir (fastest, deals with detached states), but
  // fall back to the project repo when the worktree was cleaned up by the CLI or user.
  // The branch ref is the durable handle — it survives `git worktree remove`.
  const useWorktree = todo.worktree_path && fs.existsSync(todo.worktree_path);
  const gitDir = useWorktree ? (todo.worktree_path as string) : project.path;

  // Determine the target ref. If the worktree is alive, HEAD inside it points at the
  // task's branch; otherwise we need an explicit branch name in the project repo.
  let target: string;
  if (useWorktree) {
    target = 'HEAD';
  } else {
    if (!todo.branch_name) return { ok: false, reason: 'no-branch' };
    const git = createGit(gitDir);
    try {
      await git.raw(['rev-parse', '--verify', todo.branch_name]);
    } catch {
      return { ok: false, reason: 'branch-missing' };
    }
    target = todo.branch_name;
  }

  return { ok: true, gitDir, range: `${defaultBranch}...${target}`, defaultBranch };
}

router.get('/diff/:todoId', async (req: Request, res: Response) => {
  try {
    const ctx = await resolveDiffContext(String(req.params.todoId));
    if (!ctx.ok) {
      const status = ctx.reason === 'todo-not-found' ? 404 : 200;
      return res.status(status).json({ available: false, reason: ctx.reason });
    }
    const git = createGit(ctx.gitDir);
    const files = await listDiffFiles(git, ctx.range);
    res.json({ available: true, files, defaultBranch: ctx.defaultBranch });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

router.get('/diff/:todoId/file', async (req: Request, res: Response) => {
  try {
    const filePath = (req.query.path as string | undefined)?.trim();
    if (!filePath) {
      return res.status(400).json({ error: 'path query is required' });
    }
    const ctx = await resolveDiffContext(String(req.params.todoId));
    if (!ctx.ok) {
      const status = ctx.reason === 'todo-not-found' ? 404 : 200;
      return res.status(status).json({ available: false, reason: ctx.reason });
    }
    const git = createGit(ctx.gitDir);
    // Whitelist: only allow paths reported by numstat for this branch range.
    const allowed = new Set((await listDiffFiles(git, ctx.range)).map((f) => f.path));
    if (!allowed.has(filePath)) {
      return res.status(400).json({ error: 'path not in diff' });
    }
    const diff = await git.diff([ctx.range, '-M0', '--', filePath]);
    res.json({ available: true, diff });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
