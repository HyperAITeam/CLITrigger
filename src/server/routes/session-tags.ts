import { Router, Request, Response } from 'express';
import * as queries from '../db/queries.js';

const router = Router();

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function validateColor(color: unknown): string | null {
  if (typeof color !== 'string') return null;
  const trimmed = color.trim();
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 32) return null;
  return trimmed;
}

router.get('/session-tags', (_req: Request, res: Response) => {
  try {
    res.json(queries.getSessionTags());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/session-tags', (req: Request, res: Response) => {
  try {
    const name = validateName(req.body?.name);
    const color = validateColor(req.body?.color);
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    if (!color) return res.status(400).json({ error: 'Invalid color (expect #RRGGBB)' });
    const existing = queries.getSessionTags().find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Tag name already exists' });
    res.status(201).json(queries.createSessionTag(name, color));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.put('/session-tags/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const tag = queries.getSessionTagById(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    const updates: { name?: string; color?: string; sort_order?: number } = {};
    if (req.body?.name !== undefined) {
      const name = validateName(req.body.name);
      if (!name) return res.status(400).json({ error: 'Invalid name' });
      const dup = queries.getSessionTags().find(
        (t) => t.id !== tag.id && t.name.toLowerCase() === name.toLowerCase(),
      );
      if (dup) return res.status(409).json({ error: 'Tag name already exists' });
      updates.name = name;
    }
    if (req.body?.color !== undefined) {
      const color = validateColor(req.body.color);
      if (!color) return res.status(400).json({ error: 'Invalid color (expect #RRGGBB)' });
      updates.color = color;
    }
    if (req.body?.sort_order !== undefined && Number.isFinite(req.body.sort_order)) {
      updates.sort_order = Math.floor(Number(req.body.sort_order));
    }
    res.json(queries.updateSessionTag(tag.id, updates));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/session-tags/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const tag = queries.getSessionTagById(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    queries.deleteSessionTag(tag.id);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
