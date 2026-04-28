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

interface DiffDebug {
  worktree_path: string | null;
  worktree_exists: boolean;
  branch_name: string | null;
  project_path: string | null;
}

type DiffContext = {
  ok: true;
  gitDir: string;
  range: string;
  defaultBranch: string;
  debug: DiffDebug;
};

type DiffContextErr = {
  ok: false;
  reason: 'todo-not-found' | 'no-branch' | 'branch-missing';
  debug: DiffDebug;
};

async function resolveDiffContext(todoId: string): Promise<DiffContext | DiffContextErr> {
  const emptyDebug: DiffDebug = { worktree_path: null, worktree_exists: false, branch_name: null, project_path: null };
  const todo = getTodoById(todoId);
  if (!todo) return { ok: false, reason: 'todo-not-found', debug: emptyDebug };
  const project = getProjectById(todo.project_id);
  const debug: DiffDebug = {
    worktree_path: todo.worktree_path ?? null,
    worktree_exists: !!(todo.worktree_path && fs.existsSync(todo.worktree_path)),
    branch_name: todo.branch_name ?? null,
    project_path: project?.path ?? null,
  };
  if (!project) return { ok: false, reason: 'todo-not-found', debug };

  const defaultBranch = project.default_branch || 'main';

  // The branch ref is the durable handle — it survives `git worktree remove`.
  // Strategy: if we have a branch name, use the project repo with the branch as target
  // (works whether or not the worktree dir is alive). If the worktree is alive but
  // there's no branch_name, fall back to its HEAD.
  let gitDir: string;
  let target: string;
  if (todo.branch_name) {
    gitDir = project.path;
    const git = createGit(gitDir);
    try {
      await git.raw(['rev-parse', '--verify', todo.branch_name]);
    } catch {
      // Branch missing in project repo — try the worktree as last resort.
      if (debug.worktree_exists) {
        gitDir = todo.worktree_path as string;
        target = 'HEAD';
        return { ok: true, gitDir, range: `${defaultBranch}...${target}`, defaultBranch, debug };
      }
      return { ok: false, reason: 'branch-missing', debug };
    }
    target = todo.branch_name;
  } else if (debug.worktree_exists) {
    gitDir = todo.worktree_path as string;
    target = 'HEAD';
  } else {
    return { ok: false, reason: 'no-branch', debug };
  }

  return { ok: true, gitDir, range: `${defaultBranch}...${target}`, defaultBranch, debug };
}

router.get('/diff/:todoId', async (req: Request, res: Response) => {
  try {
    const ctx = await resolveDiffContext(String(req.params.todoId));
    if (!ctx.ok) {
      const status = ctx.reason === 'todo-not-found' ? 404 : 200;
      return res.status(status).json({ available: false, reason: ctx.reason, debug: ctx.debug });
    }
    const git = createGit(ctx.gitDir);
    const files = await listDiffFiles(git, ctx.range);
    res.json({ available: true, files, defaultBranch: ctx.defaultBranch, debug: ctx.debug });
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
      return res.status(status).json({ available: false, reason: ctx.reason, debug: ctx.debug });
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
