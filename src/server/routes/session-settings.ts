import { Router, Request, Response } from 'express';
import { getSetting, setSetting } from '../db/app-settings.js';

const router = Router();

const KEY_DEFAULT_USE_WORKTREE = 'session.default_use_worktree';

interface SessionSettings {
  defaultUseWorktree: boolean;
}

function readSettings(): SessionSettings {
  return {
    defaultUseWorktree: getSetting(KEY_DEFAULT_USE_WORKTREE) === '1',
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
    res.json(readSettings());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
