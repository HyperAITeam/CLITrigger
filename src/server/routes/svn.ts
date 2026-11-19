import { Router, Request, Response } from 'express';
import nodePath from 'path';
import fs from 'fs';
import { getProjectById } from '../db/queries.js';
import { svnManager } from '../services/svn-manager.js';
import { startSvnJob, getSvnJobs, cancelSvnJob, SvnBusyError, type SvnJobKind, type SvnJobContext } from '../services/svn-jobs.js';

const router = Router();

/**
 * Resolve the working-copy root for a request.
 *
 * SVN has no concept of git's "worktree" — every working copy is independent.
 * The optional `?wcPath=` query supports phase-2 checkout-copy isolation
 * (multiple working copies under the project), validated to live under the
 * project's `.worktrees` dir to keep arbitrary path access shut.
 */
function resolveSvnPath(
  req: Request<{ id: string }>,
  res: Response
): { ok: true; path: string } | { ok: false } {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return { ok: false };
  }
  if (!project.svn_enabled) {
    res.status(400).json({ error: 'SVN is not enabled for this project' });
    return { ok: false };
  }

  const wcPath = (req.query.wcPath || req.body?.wcPath) as string | undefined;
  if (!wcPath) return { ok: true, path: project.path };

  const resolved = nodePath.resolve(wcPath);
  const base = nodePath.resolve(project.path, '.worktrees');
  if (!resolved.startsWith(base + nodePath.sep) && resolved !== base) {
    res.status(400).json({ error: 'Invalid working copy path' });
    return { ok: false };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    res.status(400).json({ error: 'Working copy path does not exist' });
    return { ok: false };
  }
  return { ok: true, path: resolved };
}

function fail(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Unknown error';
  res.status(500).json({ error: message });
}

/**
 * Mutating commands run as background jobs (services/svn-jobs.ts): 202 with
 * the job id right away, or 409 while another command holds this working copy.
 * Clients follow the job through GET /svn-job.
 */
function startJob(
  res: Response,
  wcPath: string,
  kind: SvnJobKind,
  run: (ctx: SvnJobContext) => Promise<unknown>,
  meta?: { revision?: string; cancellable?: boolean },
): void {
  try {
    const job = startSvnJob(wcPath, kind, run, meta);
    res.status(202).json({ jobId: job.id });
  } catch (err) {
    if (err instanceof SvnBusyError) res.status(409).json({ error: err.message, running: err.running });
    else fail(res, err);
  }
}

function requireFiles(req: Request, res: Response): string[] | null {
  const { files } = req.body ?? {};
  if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === 'string' && f)) {
    res.status(400).json({ error: 'files array is required' });
    return null;
  }
  return files;
}

// GET /api/projects/:id/svn-status
router.get('/:id/svn-status', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const showUpdates = req.query.showUpdates === 'true';
    const status = await svnManager.getStatus(r.path, { showUpdates });
    res.json(status);
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-info
router.get('/:id/svn-info', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const info = await svnManager.getInfo(r.path);
    res.json(info);
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-log?limit=&before=&url= — `before`: the oldest
// revision already shown; the page starts just below it.
router.get('/:id/svn-log', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : undefined;
    if (before !== undefined && !/^\d+$/.test(before)) {
      res.status(400).json({ error: 'before must be a revision number' });
      return;
    }
    const url = typeof req.query.url === 'string' && req.query.url.trim() ? req.query.url : undefined;
    const result = await svnManager.getLog(r.path, { before, limit, url });
    res.json(result);
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-url-info — HEAD revision of an external's URL (REMOTE)
router.get('/:id/svn-url-info', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const url = req.query.url;
    if (typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const revision = await svnManager.getUrlHeadRevision(r.path, url);
    res.json({ revision });
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-commit-files
router.get('/:id/svn-commit-files', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const revision = req.query.revision as string | undefined;
    if (!revision || !/^\d+$/.test(revision)) {
      res.status(400).json({ error: 'Valid revision is required' });
      return;
    }
    const files = await svnManager.getCommitFiles(r.path, revision);
    res.json({ files });
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-commit-diff
router.get('/:id/svn-commit-diff', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const revision = req.query.revision as string | undefined;
    if (!revision || !/^\d+$/.test(revision)) {
      res.status(400).json({ error: 'Valid revision is required' });
      return;
    }
    const file = req.query.file as string | undefined;
    const status = req.query.status as string | undefined;
    const diff = await svnManager.getCommitDiff(r.path, revision, file, status);
    res.json({ diff });
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-diff
router.get('/:id/svn-diff', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const file = req.query.file as string | undefined;
    const revision = req.query.revision as string | undefined;
    if (revision !== undefined && !/^\d+$/.test(revision)) {
      res.status(400).json({ error: 'Valid revision is required' });
      return;
    }
    const diff = await svnManager.getDiff(r.path, file, revision);
    res.json({ diff });
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-properties (LOCAL — reads working copy)
router.get('/:id/svn-properties', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const file = req.query.file as string | undefined;
    const properties = await svnManager.getProperties(r.path, file);
    res.json({ properties });
  } catch (err) { fail(res, err); }
});

// ── Jobs ─────────────────────────────────────────────────────────────────────

// GET /api/projects/:id/svn-job — { running, last } for this working copy
router.get('/:id/svn-job', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  res.json(getSvnJobs(r.path));
});

// POST /api/projects/:id/svn-job/cancel — stop a running update
router.post('/:id/svn-job/cancel', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  if (!cancelSvnJob(r.path)) {
    res.status(409).json({ error: 'Nothing to cancel' });
    return;
  }
  res.json({ ok: true });
});

// ── Mutations (background jobs) ──────────────────────────────────────────────

// POST /api/projects/:id/svn-add
router.post('/:id/svn-add', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const files = requireFiles(req, res);
  if (!files) return;
  startJob(res, r.path, 'add', () => svnManager.add(r.path, files));
});

// POST /api/projects/:id/svn-revert
router.post('/:id/svn-revert', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const files = requireFiles(req, res);
  if (!files) return;
  startJob(res, r.path, 'revert', () => svnManager.revert(r.path, files));
});

// POST /api/projects/:id/svn-delete
router.post('/:id/svn-delete', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const files = requireFiles(req, res);
  if (!files) return;
  const keepLocal = !!req.body.keepLocal;
  startJob(res, r.path, 'delete', () => svnManager.remove(r.path, files, keepLocal));
});

// POST /api/projects/:id/svn-resolve
router.post('/:id/svn-resolve', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const files = requireFiles(req, res);
  if (!files) return;
  const { accept } = req.body;
  const acceptMode = (['working', 'mine-full', 'theirs-full', 'base'] as const).includes(accept) ? accept : 'working';
  startJob(res, r.path, 'resolve', () => svnManager.resolve(r.path, files, acceptMode));
});

// POST /api/projects/:id/svn-changelist — assign files to a changelist (or remove when name is empty)
router.post('/:id/svn-changelist', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const files = requireFiles(req, res);
  if (!files) return;
  const { name } = req.body;
  const clName = typeof name === 'string' && name.trim() ? name.trim() : null;
  startJob(res, r.path, 'changelist', () => svnManager.changelist(r.path, clName, files));
});

// POST /api/projects/:id/svn-commit
router.post('/:id/svn-commit', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const { message, files } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  const selected = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string' && !!f) : undefined;
  startJob(res, r.path, 'commit', () => svnManager.commit(r.path, message.trim(), selected));
});

// POST /api/projects/:id/svn-update — progress lines feed the job's count/line
router.post('/:id/svn-update', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const { revision } = req.body;
  if (revision !== undefined && revision !== null && !/^\d+$|^HEAD$/i.test(String(revision))) {
    res.status(400).json({ error: 'revision must be a number or HEAD' });
    return;
  }
  const rev = revision !== undefined && revision !== null ? String(revision) : undefined;
  startJob(
    res,
    r.path,
    'update',
    ({ onLine, signal }) => svnManager.update(r.path, rev, onLine, signal),
    { revision: rev, cancellable: true },
  );
});

// POST /api/projects/:id/svn-propset (LOCAL — sets a property on the working copy)
router.post('/:id/svn-propset', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  const { file, name, value } = req.body;
  if (typeof name !== 'string' || !name.trim() || typeof value !== 'string') {
    res.status(400).json({ error: 'name and value are required' });
    return;
  }
  const target = typeof file === 'string' ? file : undefined;
  startJob(res, r.path, 'propset', () => svnManager.setProperty(r.path, name.trim(), value, target));
});

// POST /api/projects/:id/svn-cleanup
router.post('/:id/svn-cleanup', (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  startJob(res, r.path, 'cleanup', () => svnManager.cleanup(r.path));
});

export default router;
