import { Router, Request, Response } from 'express';
import { getSetting, setSetting } from '../db/app-settings.js';

const router = Router();

const KEY_DEFAULT_USE_WORKTREE = 'session.default_use_worktree';
const KEY_DEFAULT_FONT_SIZE = 'session.default_font_size';
const KEY_IME_DEBUG = 'session.ime_debug';

const FONT_MIN = 8;
const FONT_MAX = 28;
const FONT_FALLBACK = 13;

interface SessionSettings {
  defaultUseWorktree: boolean;
  defaultFontSize: number;
  imeDebug: boolean;
}

function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return FONT_FALLBACK;
  return Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
}

function readFontSize(): number {
  const raw = getSetting(KEY_DEFAULT_FONT_SIZE);
  if (raw === null || raw === undefined) return FONT_FALLBACK;
  const parsed = parseInt(raw, 10);
  return clampFontSize(parsed);
}

function readSettings(): SessionSettings {
  return {
    defaultUseWorktree: getSetting(KEY_DEFAULT_USE_WORKTREE) === '1',
    defaultFontSize: readFontSize(),
    imeDebug: getSetting(KEY_IME_DEBUG) === '1',
  };
}

router.get('/session-settings', (_req: Request, res: Response) => {
  try {
    res.json(readSettings());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.put('/session-settings', (req: Request, res: Response) => {
  try {
    if (req.body?.defaultUseWorktree !== undefined) {
      setSetting(KEY_DEFAULT_USE_WORKTREE, req.body.defaultUseWorktree ? '1' : '0');
    }
    if (req.body?.defaultFontSize !== undefined) {
      const next = clampFontSize(Number(req.body.defaultFontSize));
      setSetting(KEY_DEFAULT_FONT_SIZE, String(next));
    }
    if (req.body?.imeDebug !== undefined) {
      setSetting(KEY_IME_DEBUG, req.body.imeDebug ? '1' : '0');
    }
    res.json(readSettings());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
