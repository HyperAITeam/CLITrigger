import { Router, Request, Response } from 'express';
import * as queries from '../db/queries.js';
import { parseCommandString } from '../lib/shell-parse.js';

const router = Router();

function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}

function validateCommandTemplate(cmd: unknown): string | null {
  if (typeof cmd !== 'string') return null;
  const trimmed = cmd.trim();
  if (!trimmed || trimmed.length > 1024) return null;
  // Round-trip through the tokenizer so a template that yields zero tokens
  // (e.g. only quote characters) is rejected at write time, not at spawn time.
  try {
    parseCommandString(trimmed);
  } catch {
    return null;
  }
  return trimmed;
}

router.get('/session-aliases', (_req: Request, res: Response) => {
  try {
    res.json(queries.getSessionAliases());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/session-aliases', (req: Request, res: Response) => {
  try {
    const name = validateName(req.body?.name);
    const command = validateCommandTemplate(req.body?.command_template);
    if (!name) return res.status(400).json({ error: 'Invalid name (1-64 chars)' });
    if (!command) return res.status(400).json({ error: 'Invalid command template (must yield at least one token)' });
    const existing = queries.getSessionAliases().find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Alias name already exists' });
    res.status(201).json(queries.createSessionAlias(name, command));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.put('/session-aliases/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const alias = queries.getSessionAliasById(req.params.id);
    if (!alias) return res.status(404).json({ error: 'Alias not found' });
    const updates: { name?: string; command_template?: string; sort_order?: number } = {};
    if (req.body?.name !== undefined) {
      const name = validateName(req.body.name);
      if (!name) return res.status(400).json({ error: 'Invalid name (1-64 chars)' });
      const dup = queries.getSessionAliases().find(
        (a) => a.id !== alias.id && a.name.toLowerCase() === name.toLowerCase(),
      );
      if (dup) return res.status(409).json({ error: 'Alias name already exists' });
      updates.name = name;
    }
    if (req.body?.command_template !== undefined) {
      const command = validateCommandTemplate(req.body.command_template);
      if (!command) return res.status(400).json({ error: 'Invalid command template (must yield at least one token)' });
      updates.command_template = command;
    }
    if (req.body?.sort_order !== undefined && Number.isFinite(req.body.sort_order)) {
      updates.sort_order = Math.floor(Number(req.body.sort_order));
    }
    res.json(queries.updateSessionAlias(alias.id, updates));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/session-aliases/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const alias = queries.getSessionAliasById(req.params.id);
    if (!alias) return res.status(404).json({ error: 'Alias not found' });
    queries.deleteSessionAlias(alias.id);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
