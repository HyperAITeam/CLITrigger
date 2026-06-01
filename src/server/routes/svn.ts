import { Router, Request, Response } from 'express';
import nodePath from 'path';
import fs from 'fs';
import { getProjectById } from '../db/queries.js';
import { svnManager } from '../services/svn-manager.js';

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

// GET /api/projects/:id/svn-log
router.get('/:id/svn-log', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const skip = parseInt(req.query.skip as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const result = await svnManager.getLog(r.path, { skip, limit });
    res.json(result);
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
    const diff = await svnManager.getCommitDiff(r.path, revision, file);
    res.json({ diff });
  } catch (err) { fail(res, err); }
});

// GET /api/projects/:id/svn-diff
router.get('/:id/svn-diff', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const file = req.query.file as string | undefined;
    const diff = await svnManager.getDiff(r.path, file);
    res.json({ diff });
  } catch (err) { fail(res, err); }
});

// POST /api/projects/:id/svn-add
router.post('/:id/svn-add', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' });
      return;
    }
    await svnManager.add(r.path, files);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// POST /api/projects/:id/svn-revert
router.post('/:id/svn-revert', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' });
      return;
    }
    await svnManager.revert(r.path, files);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// POST /api/projects/:id/svn-delete
router.post('/:id/svn-delete', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const { files, keepLocal } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' });
      return;
    }
    await svnManager.remove(r.path, files, !!keepLocal);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// POST /api/projects/:id/svn-resolve
router.post('/:id/svn-resolve', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const { files, accept } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files array is required' });
      return;
    }
    const acceptMode = (['working', 'mine-full', 'theirs-full', 'base'] as const).includes(accept) ? accept : 'working';
    await svnManager.resolve(r.path, files, acceptMode);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// POST /api/projects/:id/svn-commit
router.post('/:id/svn-commit', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const { message, files } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const result = await svnManager.commit(r.path, message.trim(), Array.isArray(files) ? files : undefined);
    res.json({ ok: true, ...result });
  } catch (err) { fail(res, err); }
});

// POST /api/projects/:id/svn-update
router.post('/:id/svn-update', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    const { revision } = req.body;
    if (revision !== undefined && !/^\d+$|^HEAD$/i.test(String(revision))) {
      res.status(400).json({ error: 'revision must be a number or HEAD' });
      return;
    }
    const result = await svnManager.update(r.path, revision !== undefined ? String(revision) : undefined);
    res.json({ ok: true, ...result });
  } catch (err) { fail(res, err); }
});

// POST /api/projects/:id/svn-cleanup
router.post('/:id/svn-cleanup', async (req: Request<{ id: string }>, res: Response) => {
  const r = resolveSvnPath(req, res);
  if (!r.ok) return;
  try {
    await svnManager.cleanup(r.path);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

export default router;
