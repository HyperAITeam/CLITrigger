import { Router, Request, Response } from 'express';
import * as queries from '../db/queries.js';
import { sessionManager } from '../services/session-manager.js';

const router = Router();

// POST /api/projects/:id/sessions — create a new session
router.post('/projects/:id/sessions', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { title, description, cli_tool, cli_model } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const session = queries.createSession(
      req.params.id,
      title.trim(),
      description?.trim() || undefined,
      cli_tool || undefined,
      cli_model || undefined,
    );
    res.status(201).json(session);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/sessions — list sessions for project
router.get('/projects/:id/sessions', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const sessions = queries.getSessionsByProjectId(req.params.id);
    res.json(sessions);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/sessions/:id — get session by ID
router.get('/sessions/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/sessions/:id — update session metadata
router.put('/sessions/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status === 'running') {
      res.status(400).json({ error: 'Cannot edit a running session' });
      return;
    }

    const allowed = ['title', 'description', 'cli_tool', 'cli_model'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const updated = queries.updateSession(req.params.id, updates as any);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/sessions/:id — delete session
router.delete('/sessions/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status === 'running') {
      res.status(400).json({ error: 'Stop the session before deleting' });
      return;
    }

    queries.deleteSession(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/sessions/:id/start — start session (always interactive)
router.post('/sessions/:id/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const startable = ['pending', 'failed', 'stopped', 'completed'];
    if (!startable.includes(session.status)) {
      res.status(400).json({ error: `Cannot start session in ${session.status} state` });
      return;
    }

    await sessionManager.startSession(req.params.id);

    const updated = queries.getSessionById(req.params.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/sessions/:id/stop — stop session
router.post('/sessions/:id/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status !== 'running') {
      res.status(400).json({ error: 'Session is not running' });
      return;
    }

    await sessionManager.stopSession(req.params.id);

    const updated = queries.getSessionById(req.params.id);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/sessions/:id/logs — get session logs
router.get('/sessions/:id/logs', (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const logs = queries.getSessionLogsBySessionId(req.params.id);
    res.json(logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
