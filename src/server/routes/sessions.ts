import { Router, Request, Response } from 'express';
import * as queries from '../db/queries.js';
import { sessionManager } from '../services/session-manager.js';
import { worktreeManager } from '../services/worktree-manager.js';

const router = Router();

const RAW_DIR_PREFIX = '.clitrigger/raw/';

function normalizeRawFilePaths(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (Array.isArray(input)) {
    const cleaned = input
      .map(v => (typeof v === 'string' ? v.replace(/\\/g, '/').trim() : ''))
      .filter(p => p && p.startsWith(RAW_DIR_PREFIX) && !p.includes('..'));
    return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
  }
  if (typeof input === 'string') {
    return input.trim() ? input : null;
  }
  return null;
}

// POST /api/projects/:id/sessions — create a new session
router.post('/projects/:id/sessions', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { title, description, cli_tool, cli_model, use_worktree, memory_inject_mode, memory_node_ids, memory_raw_file_paths } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const normalizedMemMode =
      memory_inject_mode === 'all' || memory_inject_mode === 'selected' || memory_inject_mode === 'auto'
        ? memory_inject_mode
        : 'none';
    const normalizedMemIds = Array.isArray(memory_node_ids)
      ? (memory_node_ids.length > 0 ? JSON.stringify(memory_node_ids.map(String)) : null)
      : (typeof memory_node_ids === 'string' && memory_node_ids ? memory_node_ids : null);
    const normalizedRaw = normalizeRawFilePaths(memory_raw_file_paths);

    const session = queries.createSession(
      req.params.id,
      title.trim(),
      description?.trim() || undefined,
      cli_tool || undefined,
      cli_model || undefined,
      !!use_worktree,
      normalizedMemMode,
      normalizedMemIds,
      normalizedRaw === undefined ? null : normalizedRaw,
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

    const allowed = ['title', 'description', 'cli_tool', 'cli_model', 'use_worktree'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (req.body.memory_inject_mode !== undefined) {
      updates.memory_inject_mode =
        req.body.memory_inject_mode === 'all' || req.body.memory_inject_mode === 'selected' || req.body.memory_inject_mode === 'auto'
          ? req.body.memory_inject_mode
          : 'none';
    }
    if (req.body.memory_node_ids !== undefined) {
      const v = req.body.memory_node_ids;
      updates.memory_node_ids = Array.isArray(v)
        ? (v.length > 0 ? JSON.stringify(v.map(String)) : null)
        : (typeof v === 'string' && v ? v : null);
    }
    if (req.body.memory_raw_file_paths !== undefined) {
      const normalized = normalizeRawFilePaths(req.body.memory_raw_file_paths);
      updates.memory_raw_file_paths = normalized === undefined ? null : normalized;
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

// POST /api/sessions/:id/start — start session (always interactive).
// Accepts optional { cols, rows } so the client can spawn the PTY at the
// xterm.js rendered size and avoid the 200x50-default-then-resize banner
// glitches in Claude Code's TUI.
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

    const body = (req.body ?? {}) as { cols?: unknown; rows?: unknown; continueSession?: unknown };
    const hasCols = body.cols !== undefined;
    const hasRows = body.rows !== undefined;
    let opts: { cols?: number; rows?: number; continueSession?: boolean } | undefined;
    if (hasCols !== hasRows) {
      res.status(400).json({ error: 'cols and rows must both be provided or both omitted' });
      return;
    }
    if (hasCols && hasRows) {
      const cols = body.cols;
      const rows = body.rows;
      if (!Number.isInteger(cols) || !Number.isInteger(rows) ||
          (cols as number) < 20 || (cols as number) > 500 ||
          (rows as number) < 10 || (rows as number) > 200) {
        res.status(400).json({ error: 'cols must be 20-500, rows must be 10-200 (integers)' });
        return;
      }
      opts = { cols: cols as number, rows: rows as number };
    }

    if (body.continueSession === true) {
      const cliTool = session.cli_tool || 'claude';
      if (cliTool !== 'claude') {
        res.status(400).json({ error: 'Resume is only supported for Claude sessions' });
        return;
      }
      if (!session.use_worktree || !session.worktree_path) {
        res.status(400).json({ error: 'Resume requires a worktree session' });
        return;
      }
      opts = { ...(opts ?? {}), continueSession: true };
    } else if (body.continueSession !== undefined && body.continueSession !== false) {
      res.status(400).json({ error: 'continueSession must be a boolean' });
      return;
    }

    await sessionManager.startSession(req.params.id, opts);

    const updated = queries.getSessionById(req.params.id);
    const pending = sessionManager.getPendingPrompt(req.params.id);
    res.json({
      ...updated,
      pendingInitialPrompt: pending !== null,
      pendingInitialPromptLength: pending?.length ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/sessions/:id/pending-prompt — full body of the held initial prompt,
// or null if no prompt is pending. Used by the SessionWindow pre-flight panel.
router.get('/sessions/:id/pending-prompt', (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const prompt = sessionManager.getPendingPrompt(req.params.id);
    if (!prompt) {
      res.json({ prompt: null, length: 0 });
      return;
    }
    res.json({ prompt, length: prompt.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/sessions/:id/submit-initial — actually send the held initial prompt
// to the running PTY. No-op if no prompt is pending.
router.post('/sessions/:id/submit-initial', (req: Request<{ id: string }>, res: Response) => {
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
    const ok = sessionManager.submitInitialPrompt(req.params.id);
    if (!ok) {
      res.status(400).json({ error: 'No pending prompt or PTY unavailable' });
      return;
    }
    res.json({ submitted: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/sessions/:id/skip-initial — discard the held initial prompt without
// sending it. Idempotent.
router.post('/sessions/:id/skip-initial', (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    sessionManager.skipInitialPrompt(req.params.id);
    res.json({ skipped: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
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

// POST /api/sessions/:id/cleanup — remove worktree and branch for a session
router.post('/sessions/:id/cleanup', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status === 'running') {
      res.status(400).json({ error: 'Cannot cleanup a running session. Stop it first.' });
      return;
    }

    const project = queries.getProjectById(session.project_id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const deleteBranch = req.body.delete_branch !== false;
    const result = { worktreeRemoved: false, branchDeleted: false };

    if (session.worktree_path || session.branch_name) {
      const cleanup = await worktreeManager.cleanupWorktree(
        project.path,
        session.worktree_path || '',
        session.branch_name || '',
        deleteBranch
      );
      result.worktreeRemoved = cleanup.worktreeRemoved;
      result.branchDeleted = cleanup.branchDeleted;

      const updates: Record<string, null> = { worktree_path: null };
      if (deleteBranch) updates.branch_name = null;
      queries.updateSession(req.params.id, updates as any);
    }

    res.json({ success: true, ...result });
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
