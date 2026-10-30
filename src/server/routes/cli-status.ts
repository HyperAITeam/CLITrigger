import { Router, Request, Response } from 'express';
import { checkAllTools, clearCache } from '../services/cli-status.js';
import { getAvailableShells } from '../services/cli-adapters.js';

const router = Router();

// GET /api/cli/status - check all CLI tools installation status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const statuses = await checkAllTools();
    res.json(statuses);
  } catch (err) {
    console.error('Failed to check CLI status:', err);
    res.status(500).json({ error: 'Failed to check CLI status' });
  }
});

// GET /api/cli/shells - shells offered in the session new-tab menu
router.get('/shells', (_req: Request, res: Response) => {
  res.json(getAvailableShells().map(({ id, name }) => ({ id, name })));
});

// POST /api/cli/status/refresh - force refresh (clear cache)
router.post('/status/refresh', async (_req: Request, res: Response) => {
  try {
    clearCache();
    const statuses = await checkAllTools();
    res.json(statuses);
  } catch (err) {
    console.error('Failed to refresh CLI status:', err);
    res.status(500).json({ error: 'Failed to refresh CLI status' });
  }
});

export default router;
