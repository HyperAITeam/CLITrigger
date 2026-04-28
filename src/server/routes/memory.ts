import { Router, Request, Response } from 'express';
import * as queries from '../db/queries.js';
import type { MemoryRelationType } from '../db/queries.js';
import { buildMemoryBlock, type MemoryInjectMode } from '../services/memory-injector.js';

const router = Router();

const VALID_RELATION_TYPES: ReadonlySet<MemoryRelationType> = new Set([
  'related',
  'precedes',
  'example_of',
  'counter_example',
  'refines',
]);

function normalizeTags(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'string') {
    if (!input.trim()) return null;
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.map(String).map(s => s.trim()).filter(Boolean);
        return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (Array.isArray(input)) {
    const cleaned = input.map(String).map(s => s.trim()).filter(Boolean);
    return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
  }
  return null;
}

function isValidRelation(value: unknown): value is MemoryRelationType {
  return typeof value === 'string' && VALID_RELATION_TYPES.has(value as MemoryRelationType);
}

// ── Graph (combined) ──

router.get('/projects/:id/memory/graph', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const nodes = queries.getMemoryNodesByProjectId(req.params.id);
    const edges = queries.getMemoryEdgesByProjectId(req.params.id);
    res.json({ nodes, edges });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Nodes ──

router.get('/projects/:id/memory/nodes', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(queries.getMemoryNodesByProjectId(req.params.id));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/projects/:id/memory/nodes', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { title, body, tags, pinned } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const node = queries.createMemoryNode(
      req.params.id,
      title.trim(),
      typeof body === 'string' ? body : '',
      normalizeTags(tags),
      pinned ? 1 : 0,
    );
    res.status(201).json(node);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.put('/memory/nodes/:nodeId', (req: Request<{ nodeId: string }>, res: Response) => {
  try {
    const existing = queries.getMemoryNodeById(req.params.nodeId);
    if (!existing) {
      res.status(404).json({ error: 'Memory node not found' });
      return;
    }
    const { title, body, tags, pinned } = req.body ?? {};
    const updates: Parameters<typeof queries.updateMemoryNode>[1] = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'title cannot be empty' });
        return;
      }
      updates.title = title.trim();
    }
    if (body !== undefined) updates.body = typeof body === 'string' ? body : '';
    if (tags !== undefined) updates.tags = normalizeTags(tags);
    if (pinned !== undefined) updates.pinned = pinned ? 1 : 0;
    const updated = queries.updateMemoryNode(req.params.nodeId, updates);
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.put('/memory/nodes/:nodeId/position', (req: Request<{ nodeId: string }>, res: Response) => {
  try {
    const existing = queries.getMemoryNodeById(req.params.nodeId);
    if (!existing) {
      res.status(404).json({ error: 'Memory node not found' });
      return;
    }
    const { position_x, position_y } = req.body ?? {};
    const x = Number(position_x);
    const y = Number(position_y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      res.status(400).json({ error: 'position_x and position_y must be numbers' });
      return;
    }
    queries.updateMemoryNodePosition(req.params.nodeId, x, y);
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/memory/nodes/:nodeId', (req: Request<{ nodeId: string }>, res: Response) => {
  try {
    const existing = queries.getMemoryNodeById(req.params.nodeId);
    if (!existing) {
      res.status(404).json({ error: 'Memory node not found' });
      return;
    }
    queries.deleteMemoryNode(req.params.nodeId);
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Edges ──

router.post('/projects/:id/memory/edges', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { from_node_id, to_node_id, relation_type, label } = req.body ?? {};
    if (!from_node_id || !to_node_id) {
      res.status(400).json({ error: 'from_node_id and to_node_id are required' });
      return;
    }
    if (from_node_id === to_node_id) {
      res.status(400).json({ error: 'Self-edges are not allowed' });
      return;
    }
    const fromNode = queries.getMemoryNodeById(from_node_id);
    const toNode = queries.getMemoryNodeById(to_node_id);
    if (!fromNode || !toNode) {
      res.status(404).json({ error: 'Source or target node not found' });
      return;
    }
    if (fromNode.project_id !== req.params.id || toNode.project_id !== req.params.id) {
      res.status(400).json({ error: 'Nodes must belong to this project' });
      return;
    }
    const rt: MemoryRelationType = isValidRelation(relation_type) ? relation_type : 'related';
    try {
      const edge = queries.createMemoryEdge(req.params.id, from_node_id, to_node_id, rt, label ?? null);
      res.status(201).json(edge);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) {
        res.status(409).json({ error: 'An edge with this relation already exists between these nodes' });
        return;
      }
      throw err;
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.put('/memory/edges/:edgeId', (req: Request<{ edgeId: string }>, res: Response) => {
  try {
    const existing = queries.getMemoryEdgeById(req.params.edgeId);
    if (!existing) {
      res.status(404).json({ error: 'Memory edge not found' });
      return;
    }
    const { relation_type, label } = req.body ?? {};
    const updates: Parameters<typeof queries.updateMemoryEdge>[1] = {};
    if (relation_type !== undefined) {
      if (!isValidRelation(relation_type)) {
        res.status(400).json({ error: 'Invalid relation_type' });
        return;
      }
      updates.relation_type = relation_type;
    }
    if (label !== undefined) updates.label = label === null ? null : String(label);
    const updated = queries.updateMemoryEdge(req.params.edgeId, updates);
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/memory/edges/:edgeId', (req: Request<{ edgeId: string }>, res: Response) => {
  try {
    const existing = queries.getMemoryEdgeById(req.params.edgeId);
    if (!existing) {
      res.status(404).json({ error: 'Memory edge not found' });
      return;
    }
    queries.deleteMemoryEdge(req.params.edgeId);
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Preview (build prompt block) ──

router.post('/projects/:id/memory/preview', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { mode, nodeIds } = req.body ?? {};
    const m: MemoryInjectMode = (mode === 'all' || mode === 'selected') ? mode : 'none';
    const ids = Array.isArray(nodeIds) ? nodeIds.map(String).filter(Boolean) : [];
    const result = buildMemoryBlock({ projectId: req.params.id, mode: m, nodeIds: ids });
    res.json({
      prompt: result?.block ?? '',
      nodeCount: result?.nodeCount ?? 0,
      edgeCount: result?.edgeCount ?? 0,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
