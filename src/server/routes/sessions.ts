import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { execFileSync } from 'child_process';
import * as queries from '../db/queries.js';
import { sessionManager } from '../services/session-manager.js';
import { worktreeManager } from '../services/worktree-manager.js';
import { writeImageToClipboard } from '../services/clipboard-writer.js';
import { claudeManager } from '../services/claude-manager.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

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

    // cli_model is no longer accepted — model selection was removed and
    // execution always uses the CLI's default model.
    const { title, description, cli_tool, use_worktree, memory_inject_mode, memory_node_ids, memory_raw_file_paths, tag_id } = req.body;
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    const finalTitle = trimmedTitle || `Session ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    let normalizedTagId: string | null = null;
    if (typeof tag_id === 'string' && tag_id.trim()) {
      const tag = queries.getSessionTagById(tag_id.trim());
      if (!tag) {
        res.status(400).json({ error: 'Invalid tag_id' });
        return;
      }
      normalizedTagId = tag.id;
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
      finalTitle,
      description?.trim() || undefined,
      cli_tool || undefined,
      undefined,
      !!use_worktree,
      normalizedMemMode,
      normalizedMemIds,
      normalizedRaw === undefined ? null : normalizedRaw,
      normalizedTagId,
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

    const allowed = ['title', 'description', 'cli_tool', 'use_worktree'] as const;
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
    if (req.body.tag_id !== undefined) {
      if (req.body.tag_id === null || req.body.tag_id === '') {
        updates.tag_id = null;
      } else if (typeof req.body.tag_id === 'string') {
        const tag = queries.getSessionTagById(req.body.tag_id.trim());
        if (!tag) {
          res.status(400).json({ error: 'Invalid tag_id' });
          return;
        }
        updates.tag_id = tag.id;
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
    const result: { worktreeRemoved: boolean; branchDeleted: boolean; worktreeError?: string; branchError?: string } = {
      worktreeRemoved: false,
      branchDeleted: false,
    };

    if (session.worktree_path || session.branch_name) {
      const cleanup = await worktreeManager.cleanupWorktree(
        project.path,
        session.worktree_path || '',
        session.branch_name || '',
        deleteBranch
      );
      result.worktreeRemoved = cleanup.worktreeRemoved;
      result.branchDeleted = cleanup.branchDeleted;
      if (cleanup.worktreeError) result.worktreeError = cleanup.worktreeError;
      if (cleanup.branchError) result.branchError = cleanup.branchError;

      // Only clear DB fields that were actually cleaned up — otherwise the UI
      // would lose the handle to a still-existing worktree/branch and the user
      // couldn't retry from the UI.
      const updates: Record<string, null> = {};
      if (cleanup.worktreeRemoved) updates.worktree_path = null;
      if (deleteBranch && cleanup.branchDeleted) updates.branch_name = null;
      if (Object.keys(updates).length > 0) {
        queries.updateSession(req.params.id, updates as any);
      }
    }

    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/sessions/:id/clipboard-image-path — check OS clipboard for copied image file path
router.get('/sessions/:id/clipboard-image-path', (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    if (process.platform !== 'win32') {
      res.json({ path: null });
      return;
    }

    const out = execFileSync('powershell', [
      '-NoProfile', '-Command',
      'Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }',
    ], { encoding: 'utf-8', timeout: 3000, windowsHide: true }).trim();

    if (!out) { res.json({ path: null }); return; }

    const filePath = out.split(/\r?\n/).find(line => {
      const ext = path.extname(line).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && fs.existsSync(line);
    });

    res.json({ path: filePath || null });
  } catch {
    res.json({ path: null });
  }
});

// POST /api/sessions/:id/paste-image — push the bitmap into the host OS
// clipboard and inject `\x1bv` (Alt+V) into the PTY so the CLI subprocess
// (Claude/Codex/Gemini) fires its native image-paste handler in the same
// transaction. The ESC+v MUST be sent server-side, immediately after the
// clipboard write, so concurrent paste-image requests can't race on the
// shared OS clipboard (e.g. paste-B's write landing before paste-A's CLI
// read fires, which would leak B's bitmap into A's [Image #N]). No file
// is written to disk.
router.post('/sessions/:id/paste-image', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const session = queries.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.cli_tool === 'raw-shell') {
      res.status(400).json({ error: 'Image paste is only supported for AI CLI sessions' });
      return;
    }

    const { data } = req.body as { data: string; name?: string };
    if (!data || typeof data !== 'string') {
      res.status(400).json({ error: 'data (base64 data URL) is required' });
      return;
    }

    const match = data.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: 'Invalid image data URL format' });
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
      res.status(400).json({ error: 'Image exceeds 10MB limit' });
      return;
    }

    await writeImageToClipboard(buffer);
    // Mirror the websocket gate (`hasPendingPrompt`) so a paste during the
    // Send/Skip pre-flight banner doesn't leak ESC+v into a PTY that's
    // still waiting on the initial prompt.
    if (
      session.process_pid &&
      session.status === 'running' &&
      !sessionManager.hasPendingPrompt(session.id)
    ) {
      claudeManager.writeStdinRaw(session.process_pid, '\x1bv');
    }
    res.json({ pasted: true });
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
