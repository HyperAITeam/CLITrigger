import { Router, Request, Response } from 'express';
import nodePath from 'path';
import fs from 'fs';
import { exec, spawn } from 'child_process';
import * as queries from '../db/queries.js';

const router = Router();

const MAX_TARGET_LEN = 4096;
const MAX_ARGS_COUNT = 64;
const ALLOWED_TYPES = ['executable', 'command', 'url'] as const;
type FavoriteType = (typeof ALLOWED_TYPES)[number];

function isValidType(t: unknown): t is FavoriteType {
  return typeof t === 'string' && (ALLOWED_TYPES as readonly string[]).includes(t);
}

function normalizeArgs(input: unknown): string[] | null {
  if (input === null || input === undefined) return null;
  if (Array.isArray(input)) {
    const cleaned = input
      .map((s) => (typeof s === 'string' ? s : String(s)))
      .filter((s) => s.length > 0);
    if (cleaned.length === 0) return null;
    if (cleaned.length > MAX_ARGS_COUNT) return cleaned.slice(0, MAX_ARGS_COUNT);
    return cleaned;
  }
  if (typeof input === 'string' && input.trim().length === 0) return null;
  return null;
}

function validatePayload(body: any): { ok: true; value: { name: string; type: FavoriteType; target: string; args: string | null; cwd: string | null; icon: string | null } } | { ok: false; error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };

  if (!isValidType(body?.type)) return { ok: false, error: 'invalid type' };
  const type: FavoriteType = body.type;

  const target = typeof body?.target === 'string' ? body.target.trim() : '';
  if (!target) return { ok: false, error: 'target is required' };
  if (target.length > MAX_TARGET_LEN) return { ok: false, error: 'target too long' };

  if (type === 'url') {
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false, error: 'url must start with http:// or https://' };
    }
  }

  const argsArr = normalizeArgs(body?.args);
  const args = argsArr ? JSON.stringify(argsArr) : null;

  const cwdInput = typeof body?.cwd === 'string' ? body.cwd.trim() : '';
  const cwd = cwdInput ? cwdInput : null;

  const iconInput = typeof body?.icon === 'string' ? body.icon.trim() : '';
  const icon = iconInput ? iconInput : null;

  return { ok: true, value: { name, type, target, args, cwd, icon } };
}

function parseStoredArgs(args: string | null): string[] {
  if (!args) return [];
  try {
    const parsed = JSON.parse(args);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === 'string');
  } catch { /* ignore */ }
  return [];
}

// GET /api/favorites - list all
router.get('/favorites', (_req: Request, res: Response) => {
  try {
    const favorites = queries.getAllFavorites();
    res.json(favorites);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/favorites - create
router.post('/favorites', (req: Request, res: Response) => {
  try {
    const validation = validatePayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const { name, type, target, args, cwd, icon } = validation.value;
    const existing = queries.getAllFavorites();
    const sortOrder = existing.length;
    const favorite = queries.createFavorite(name, type, target, args, cwd, icon, sortOrder);
    res.status(201).json(favorite);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/favorites/:id - update
router.put('/favorites/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = queries.getFavoriteById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Favorite not found' });
      return;
    }
    const validation = validatePayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const updated = queries.updateFavorite(req.params.id, validation.value);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/favorites/:id - delete
router.delete('/favorites/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const existing = queries.getFavoriteById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Favorite not found' });
      return;
    }
    queries.deleteFavorite(req.params.id);
    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/favorites/:id/launch - fire-and-forget execution via OS
router.post('/favorites/:id/launch', (req: Request<{ id: string }>, res: Response) => {
  const favorite = queries.getFavoriteById(req.params.id);
  if (!favorite) {
    res.status(404).json({ error: 'Favorite not found' });
    return;
  }

  const cwd = favorite.cwd ? nodePath.normalize(favorite.cwd) : undefined;
  if (cwd && !fs.existsSync(cwd)) {
    res.status(400).json({ error: 'cwd does not exist' });
    return;
  }

  try {
    if (favorite.type === 'url') {
      // Re-validate at launch time (DB content could have been hand-edited)
      if (!/^https?:\/\//i.test(favorite.target)) {
        res.status(400).json({ error: 'invalid url scheme' });
        return;
      }
      const target = favorite.target;
      if (process.platform === 'win32') {
        // start "" "<url>" via cmd to launch default browser
        const child = spawn('cmd.exe', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore' });
        child.on('error', () => { /* swallow */ });
        child.unref();
      } else if (process.platform === 'darwin') {
        const child = spawn('open', [target], { detached: true, stdio: 'ignore' });
        child.on('error', () => { /* swallow */ });
        child.unref();
      } else {
        const child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
        child.on('error', () => { /* swallow */ });
        child.unref();
      }
      res.json({ ok: true });
      return;
    }

    if (favorite.type === 'executable') {
      const target = nodePath.normalize(favorite.target);
      const args = parseStoredArgs(favorite.args);
      const ext = nodePath.extname(target).toLowerCase();
      const useShell = process.platform === 'win32' && (ext === '.bat' || ext === '.cmd');
      const child = spawn(target, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        shell: useShell,
        windowsHide: false,
      });
      child.on('error', () => { /* swallow */ });
      child.unref();
      res.json({ ok: true });
      return;
    }

    // command
    const child = exec(favorite.target, { cwd, windowsHide: false });
    child.on('error', () => { /* swallow */ });
    child.unref?.();
    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'launch failed';
    res.status(500).json({ error: message });
  }
});

export default router;
