import { Router, Request, Response } from 'express';
import { checkAllTools, clearCache } from '../services/cli-status.js';

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
