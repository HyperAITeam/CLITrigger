import { Router, Request, Response } from 'express';
import { osOpenPath } from '../utils/open-path.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as queries from '../db/queries.js';
import type { MemoryRelationType } from '../db/queries.js';
import { buildMemoryBlock, buildRawFileBlock, type MemoryInjectMode } from '../services/memory-injector.js';
import { ingestSource, lintWiki, buildSourceTextFromTodo, buildSourceTextFromDiscussion } from '../services/memory-ingest.js';
import {
  appendWikilinkToBody,
  findBacklinks,
  parseWikilinks,
  replaceTitleInBody,
  resolveWikilinks,
} from '../services/memory-wikilinks.js';
import { dispatchWikiExport, exportProjectWikiSync, diffProjectWikiSync } from '../services/wiki-exporter.js';

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
    // First-time bootstrap: if the project has wiki nodes but no exported folder yet
    // (e.g. user upgraded), kick off a one-time export so the markdown mirror exists.
    if (project.path && nodes.length > 0) {
      try {
        const wikiDir = path.join(project.path, '.clitrigger', 'wiki');
        if (!fs.existsSync(wikiDir)) dispatchWikiExport(req.params.id);
      } catch { /* ignore */ }
    }
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
    const trimmedTitle = title.trim();
    if (queries.getMemoryNodeByTitle(req.params.id, trimmedTitle)) {
      res.status(409).json({ error: 'A memory node with this title already exists in this project' });
      return;
    }
    try {
      const node = queries.createMemoryNode(
        req.params.id,
        trimmedTitle,
        typeof body === 'string' ? body : '',
        normalizeTags(tags),
        pinned ? 1 : 0,
      );
      dispatchWikiExport(req.params.id);
      res.status(201).json(node);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) {
        res.status(409).json({ error: 'A memory node with this title already exists in this project' });
        return;
      }
      throw err;
    }
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
    let titleChange: { from: string; to: string } | null = null;
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'title cannot be empty' });
        return;
      }
      const trimmed = title.trim();
      if (trimmed.toLowerCase() !== existing.title.toLowerCase()) {
        const conflict = queries.getMemoryNodeByTitle(existing.project_id, trimmed);
        if (conflict && conflict.id !== existing.id) {
          res.status(409).json({ error: 'A memory node with this title already exists in this project' });
          return;
        }
      }
      if (trimmed !== existing.title) {
        titleChange = { from: existing.title, to: trimmed };
      }
      updates.title = trimmed;
    }
    if (body !== undefined) updates.body = typeof body === 'string' ? body : '';
    if (tags !== undefined) updates.tags = normalizeTags(tags);
    if (pinned !== undefined) updates.pinned = pinned ? 1 : 0;

    let updated;
    try {
      updated = queries.updateMemoryNode(req.params.nodeId, updates);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) {
        res.status(409).json({ error: 'A memory node with this title already exists in this project' });
        return;
      }
      throw err;
    }

    // Cascade rename: rewrite [[oldTitle]] → [[newTitle]] across other nodes' bodies
    if (titleChange) {
      const others = queries.getMemoryNodesByProjectId(existing.project_id);
      for (const other of others) {
        if (other.id === existing.id) continue;
        if (!other.body) continue;
        const rewritten = replaceTitleInBody(other.body, titleChange.from, titleChange.to);
        if (rewritten !== other.body) {
          queries.updateMemoryNode(other.id, { body: rewritten });
        }
      }
    }

    dispatchWikiExport(existing.project_id);
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
    dispatchWikiExport(existing.project_id);
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Wikilinks (body-level references) ──

router.get('/memory/nodes/:nodeId/backlinks', (req: Request<{ nodeId: string }>, res: Response) => {
  try {
    const node = queries.getMemoryNodeById(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Memory node not found' });
      return;
    }
    const hits = findBacklinks(node.project_id, node.title, node.id);
    res.json(hits.map(h => ({
      id: h.source.id,
      title: h.source.title,
      snippet: h.snippet,
    })));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/memory/nodes/:nodeId/insert-link', (req: Request<{ nodeId: string }>, res: Response) => {
  try {
    const source = queries.getMemoryNodeById(req.params.nodeId);
    if (!source) {
      res.status(404).json({ error: 'Source node not found' });
      return;
    }
    const { targetTitle, targetNodeId } = req.body ?? {};
    let title: string | undefined;
    if (targetNodeId) {
      const target = queries.getMemoryNodeById(String(targetNodeId));
      if (!target || target.project_id !== source.project_id) {
        res.status(404).json({ error: 'Target node not found in this project' });
        return;
      }
      title = target.title;
    } else if (typeof targetTitle === 'string' && targetTitle.trim()) {
      title = targetTitle.trim();
    } else {
      res.status(400).json({ error: 'targetTitle or targetNodeId required' });
      return;
    }
    const newBody = appendWikilinkToBody(source.body || '', title);
    const updated = queries.updateMemoryNode(source.id, { body: newBody });
    dispatchWikiExport(source.project_id);
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Merge `absorbId` into `keepId`: combine bodies, union tags, rewrite edges + wikilinks,
// then delete `absorbId`. Used by Lint's "duplicate" fix action.
router.post('/memory/nodes/:keepId/merge', (req: Request<{ keepId: string }>, res: Response) => {
  try {
    const { absorbId } = req.body ?? {};
    if (!absorbId || typeof absorbId !== 'string') {
      res.status(400).json({ error: 'absorbId is required' });
      return;
    }
    const keep = queries.getMemoryNodeById(req.params.keepId);
    const absorb = queries.getMemoryNodeById(absorbId);
    if (!keep || !absorb) {
      res.status(404).json({ error: 'One or both nodes not found' });
      return;
    }
    if (keep.id === absorb.id) {
      res.status(400).json({ error: 'Cannot merge a node into itself' });
      return;
    }
    if (keep.project_id !== absorb.project_id) {
      res.status(400).json({ error: 'Nodes must belong to the same project' });
      return;
    }

    const tagsToArray = (raw: string | null): string[] => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String).map(s => s.trim()).filter(Boolean) : [];
      } catch { return []; }
    };

    // 1. Combine bodies (keep's body first, then absorb's beneath a separator)
    const keepBody = (keep.body ?? '').trim();
    const absorbBody = (absorb.body ?? '').trim();
    let mergedBody = keepBody;
    if (absorbBody) {
      const sep = keepBody ? `\n\n---\n*Merged from "${absorb.title}":*\n\n` : '';
      mergedBody = `${keepBody}${sep}${absorbBody}`;
    }

    // 2. Tag union (case-insensitive dedupe, preserve keep's order)
    const keepTags = tagsToArray(keep.tags);
    const seenTags = new Set(keepTags.map(t => t.toLowerCase()));
    for (const t of tagsToArray(absorb.tags)) {
      if (!seenTags.has(t.toLowerCase())) {
        keepTags.push(t);
        seenTags.add(t.toLowerCase());
      }
    }
    const mergedTags = keepTags.length > 0 ? JSON.stringify(keepTags) : null;

    // 3. Re-route edges from/to absorb → keep, dropping self-edges and UNIQUE conflicts.
    const allEdges = queries.getMemoryEdgesByProjectId(keep.project_id);
    const existingKey = new Set<string>();
    for (const e of allEdges) {
      if (e.from_node_id === absorb.id || e.to_node_id === absorb.id) continue;
      existingKey.add(`${e.from_node_id}::${e.to_node_id}::${e.relation_type}`);
    }
    for (const e of allEdges) {
      if (e.from_node_id !== absorb.id && e.to_node_id !== absorb.id) continue;
      const newFrom = e.from_node_id === absorb.id ? keep.id : e.from_node_id;
      const newTo = e.to_node_id === absorb.id ? keep.id : e.to_node_id;
      queries.deleteMemoryEdge(e.id);
      if (newFrom === newTo) continue; // would be a self-edge
      const key = `${newFrom}::${newTo}::${e.relation_type}`;
      if (existingKey.has(key)) continue;
      try {
        queries.createMemoryEdge(keep.project_id, newFrom, newTo, e.relation_type, e.label);
        existingKey.add(key);
      } catch { /* ignore lingering UNIQUE conflicts */ }
    }

    // 4. Cascade-rewrite [[absorb.title]] → [[keep.title]] in all other nodes
    const others = queries.getMemoryNodesByProjectId(keep.project_id);
    for (const other of others) {
      if (other.id === keep.id || other.id === absorb.id) continue;
      if (!other.body) continue;
      const rewritten = replaceTitleInBody(other.body, absorb.title, keep.title);
      if (rewritten !== other.body) {
        queries.updateMemoryNode(other.id, { body: rewritten });
      }
    }

    // 5. Apply merged content to keep, then delete absorb (CASCADE drops any leftover edges)
    const updated = queries.updateMemoryNode(keep.id, { body: mergedBody, tags: mergedTags });
    queries.deleteMemoryNode(absorb.id);

    try {
      queries.createMemoryLog(
        keep.project_id,
        'merge',
        `Merged "${absorb.title}" into "${keep.title}"`,
        {
          severity: 'info',
          sourceTitle: keep.title,
          metadata: { keepId: keep.id, absorbId: absorb.id, absorbTitle: absorb.title },
        },
      );
    } catch (err) {
      console.warn('[memory-merge] failed to write memory_logs entry:', err);
    }

    dispatchWikiExport(keep.project_id);
    res.json({ node: updated, absorbed: { id: absorb.id, title: absorb.title } });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/projects/:id/memory/wikilinks/resolve', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { body, titles } = req.body ?? {};
    let titleList: string[] = [];
    if (Array.isArray(titles)) {
      titleList = titles.map(String).filter(Boolean);
    } else if (typeof body === 'string') {
      titleList = parseWikilinks(body).map(r => r.title);
    } else {
      res.status(400).json({ error: 'Provide body or titles[]' });
      return;
    }
    const resolved = resolveWikilinks(req.params.id, titleList);
    res.json(resolved);
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
      dispatchWikiExport(req.params.id);
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
    dispatchWikiExport(existing.project_id);
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
    dispatchWikiExport(existing.project_id);
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Ingest (LLM-driven wiki update from raw source) ──

router.post('/projects/:id/memory/ingest', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { source_text, source_type, source_id, locale } = req.body ?? {};
    const stype: string | null = typeof source_type === 'string' ? source_type : null;
    const sid: string | null = typeof source_id === 'string' ? source_id : null;
    const localeStr: string | null = typeof locale === 'string' ? locale : null;

    let text: string;
    let titleHint: string | null = null;

    if (stype === 'todo' && sid) {
      const todo = queries.getTodoById(sid);
      if (!todo || todo.project_id !== project.id) {
        res.status(404).json({ error: 'Todo not found' });
        return;
      }
      const built = buildSourceTextFromTodo(sid);
      if (!built) {
        res.status(400).json({ error: 'Todo has no ingestable content yet' });
        return;
      }
      text = built;
      titleHint = todo.title;
    } else if (stype === 'discussion' && sid) {
      const discussion = queries.getDiscussionById(sid);
      if (!discussion || discussion.project_id !== project.id) {
        res.status(404).json({ error: 'Discussion not found' });
        return;
      }
      const built = buildSourceTextFromDiscussion(sid);
      if (!built) {
        res.status(400).json({ error: 'Discussion has no ingestable content yet' });
        return;
      }
      text = built;
      titleHint = discussion.title;
    } else {
      // manual paste (or any direct source_text)
      if (!source_text || typeof source_text !== 'string' || !source_text.trim()) {
        res.status(400).json({ error: 'source_text is required for manual ingest' });
        return;
      }
      text = source_text.trim();
    }

    const result = await ingestSource(
      req.params.id,
      text,
      stype === 'todo' || stype === 'discussion' ? stype : 'manual',
      sid,
      titleHint,
      localeStr,
    );
    // ingestSource already dispatches the wiki export internally
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Raw source viewer ──

const RAW_SOURCE_TYPES = ['todo', 'discussion', 'manual'] as const;
const RAW_DIR = '.clitrigger/raw';

router.get('/projects/:id/memory/raw-files', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.path) {
      res.json({ files: [] });
      return;
    }

    const allNodes = queries.getMemoryNodesByProjectId(req.params.id);
    const derivedByPath = new Map<string, string[]>();
    for (const n of allNodes) {
      if (!n.source_path) continue;
      const list = derivedByPath.get(n.source_path);
      if (list) list.push(n.id);
      else derivedByPath.set(n.source_path, [n.id]);
    }

    const projectRoot = path.resolve(project.path);
    const files: Array<{
      source_type: string;
      filename: string;
      relative_path: string;
      size: number;
      mtime: string;
      derived_node_ids: string[];
    }> = [];

    for (const sourceType of RAW_SOURCE_TYPES) {
      const dir = path.join(projectRoot, RAW_DIR, sourceType);
      if (!fs.existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const filename of entries) {
        if (filename.startsWith('.')) continue;
        const absPath = path.join(dir, filename);
        const resolvedAbs = path.resolve(absPath);
        const resolvedDir = path.resolve(dir);
        if (!resolvedAbs.startsWith(resolvedDir + path.sep)) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(absPath);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        const relativePath = `${RAW_DIR}/${sourceType}/${filename}`;
        files.push({
          source_type: sourceType,
          filename,
          relative_path: relativePath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          derived_node_ids: derivedByPath.get(relativePath) ?? [],
        });
      }
    }

    files.sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ files });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/projects/:id/memory/raw-files/content', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project || !project.path) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const relPathRaw = req.query.path;
    if (typeof relPathRaw !== 'string' || !relPathRaw.trim()) {
      res.status(400).json({ error: 'path query param is required' });
      return;
    }
    const projectRoot = path.resolve(project.path);
    const rawRoot = path.resolve(projectRoot, RAW_DIR);
    const absPath = path.resolve(projectRoot, relPathRaw);
    if (!absPath.startsWith(rawRoot + path.sep)) {
      res.status(400).json({ error: 'Path must be within the raw sources directory' });
      return;
    }
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Raw file not found', path: relPathRaw });
      return;
    }
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      res.status(400).json({ error: 'Path is not a file' });
      return;
    }
    const content = fs.readFileSync(absPath, 'utf-8');
    res.type('text/markdown; charset=utf-8').send(content);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/projects/:id/memory/raw-files/open', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project || !project.path) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { path: relPathRaw, mode } = req.body ?? {};
    if (typeof relPathRaw !== 'string' || !relPathRaw.trim()) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const projectRoot = path.resolve(project.path);
    const rawRoot = path.resolve(projectRoot, RAW_DIR);
    const absPath = path.resolve(projectRoot, relPathRaw);
    if (!absPath.startsWith(rawRoot + path.sep)) {
      res.status(400).json({ error: 'Path must be within the raw sources directory' });
      return;
    }
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Raw file not found', path: relPathRaw });
      return;
    }
    // mode === 'reveal' → open the containing folder, else open the file itself
    osOpenPath(absPath, { reveal: mode === 'reveal' });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// DELETE /api/projects/:id/memory/raw-files — remove a raw snapshot file and
// null the source_path on every wiki node that derived from it. The nodes
// themselves are kept (the wiki layer is the value, not the raw layer).
router.delete('/projects/:id/memory/raw-files', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project || !project.path) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { path: relPathRaw } = req.body ?? {};
    if (typeof relPathRaw !== 'string' || !relPathRaw.trim()) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const projectRoot = path.resolve(project.path);
    const rawRoot = path.resolve(projectRoot, RAW_DIR);
    const absPath = path.resolve(projectRoot, relPathRaw);
    if (!absPath.startsWith(rawRoot + path.sep)) {
      res.status(400).json({ error: 'Path must be within the raw sources directory' });
      return;
    }
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Raw file not found', path: relPathRaw });
      return;
    }

    // Unlink derived nodes first so a partial failure doesn't leave dangling
    // source_path values pointing at a missing file.
    const allNodes = queries.getMemoryNodesByProjectId(req.params.id);
    const unlinkedIds: string[] = [];
    for (const n of allNodes) {
      if (n.source_path === relPathRaw) {
        queries.updateMemoryNode(n.id, { source_path: null });
        unlinkedIds.push(n.id);
      }
    }

    try {
      fs.unlinkSync(absPath);
    } catch (err) {
      res.status(500).json({ error: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    res.json({ deleted: relPathRaw, unlinkedNodeIds: unlinkedIds });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/memory/nodes/:nodeId/raw', (req: Request<{ nodeId: string }>, res: Response) => {
  try {
    const node = queries.getMemoryNodeById(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Memory node not found' });
      return;
    }
    if (!node.source_path) {
      res.status(404).json({ error: 'No raw source associated with this node' });
      return;
    }
    const project = queries.getProjectById(node.project_id);
    if (!project || !project.path) {
      res.status(404).json({ error: 'Project path unavailable' });
      return;
    }
    // Path traversal guard: resolved path must be under project root
    const absPath = path.resolve(project.path, node.source_path);
    const projectRoot = path.resolve(project.path);
    if (!absPath.startsWith(projectRoot + path.sep) && absPath !== projectRoot) {
      res.status(400).json({ error: 'Invalid source path' });
      return;
    }
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Raw source file no longer exists', path: node.source_path });
      return;
    }
    const content = fs.readFileSync(absPath, 'utf-8');
    res.type('text/markdown; charset=utf-8').send(content);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Lint (LLM-driven wiki health check) ──

router.post('/projects/:id/memory/lint', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const issues = await lintWiki(req.params.id);
    res.json({ issues });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Wiki assets (image uploads embedded in node bodies) ──

const WIKI_ASSETS_DIR = '.clitrigger/wiki-assets';
const ASSET_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/;
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

function slugifyAssetName(name: string): string {
  if (!name) return 'image';
  return name
    .replace(/\.[^.]+$/, '') // strip extension
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'image';
}

router.post('/projects/:id/memory/assets', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.path) {
      res.status(400).json({ error: 'Project has no local path — cannot store assets' });
      return;
    }
    const { name, data } = req.body ?? {};
    if (typeof data !== 'string') {
      res.status(400).json({ error: 'data (image data URL) is required' });
      return;
    }
    const match = data.match(IMAGE_DATA_URL_RE);
    if (!match) {
      res.status(400).json({ error: 'Unsupported image format (png/jpeg/gif/webp/svg only)' });
      return;
    }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1] === 'svg+xml' ? 'svg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > ASSET_MAX_BYTES) {
      res.status(413).json({ error: 'Image too large (max 10MB)' });
      return;
    }

    const dir = path.join(project.path, WIKI_ASSETS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const slug = slugifyAssetName(typeof name === 'string' ? name : 'image');
    const filename = `${uuidv4().slice(0, 8)}-${slug}.${ext}`;
    const filePath = path.join(dir, filename);
    const resolved = path.resolve(filePath);
    const resolvedDir = path.resolve(dir);
    if (!resolved.startsWith(resolvedDir + path.sep)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    fs.writeFileSync(filePath, buffer);
    const relativePath = `${WIKI_ASSETS_DIR}/${filename}`;
    res.status(201).json({ filename, relativePath, size: buffer.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/projects/:id/memory/assets/:filename', (req: Request<{ id: string; filename: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project || !project.path) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const dir = path.join(project.path, WIKI_ASSETS_DIR);
    const absPath = path.resolve(dir, req.params.filename);
    const resolvedDir = path.resolve(dir);
    if (!absPath.startsWith(resolvedDir + path.sep)) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    const ext = path.extname(absPath).toLowerCase().slice(1);
    res.setHeader('Content-Type', IMAGE_MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(absPath);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Wiki Markdown export (DB → .clitrigger/wiki/ one-way mirror) ──

router.get('/projects/:id/memory/disk-diff', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.path) {
      res.status(400).json({ error: 'Project has no local path' });
      return;
    }
    const diff = diffProjectWikiSync(req.params.id);
    if (diff === null) {
      res.status(400).json({ error: 'Wiki diff unavailable — project path missing or unreachable' });
      return;
    }
    res.json({ diff });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/projects/:id/memory/export', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.path) {
      res.status(400).json({ error: 'Project has no local path — cannot export' });
      return;
    }
    const result = exportProjectWikiSync(req.params.id);
    if (!result) {
      res.status(400).json({ error: 'Export skipped — project path missing or unreachable' });
      return;
    }
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── Activity log (ingest/lint/retrieve/merge events) ──

router.get('/projects/:id/memory/logs', (req: Request<{ id: string }>, res: Response) => {
  try {
    const project = queries.getProjectById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const limitRaw = req.query.limit;
    const limit = typeof limitRaw === 'string' ? Math.min(Math.max(parseInt(limitRaw, 10) || 200, 1), 1000) : 200;
    const logs = queries.getMemoryLogsByProjectId(req.params.id, limit);
    res.json({ logs });
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
    const { mode, nodeIds, rawFilePaths } = req.body ?? {};
    const m: MemoryInjectMode = (mode === 'all' || mode === 'selected') ? mode : 'none';
    const ids = Array.isArray(nodeIds) ? nodeIds.map(String).filter(Boolean) : [];
    const rawPaths = Array.isArray(rawFilePaths) ? rawFilePaths.map(String).filter(Boolean) : [];

    const nodeResult = m !== 'none'
      ? buildMemoryBlock({ projectId: req.params.id, mode: m, nodeIds: ids })
      : null;
    const rawResult = (rawPaths.length > 0 && project.path)
      ? buildRawFileBlock(project.path, rawPaths)
      : null;

    const segments: string[] = [];
    if (nodeResult?.block) segments.push(nodeResult.block);
    if (rawResult && rawResult.fileCount > 0) segments.push(rawResult.block);

    res.json({
      prompt: segments.join('\n\n'),
      nodeCount: nodeResult?.nodeCount ?? 0,
      edgeCount: nodeResult?.edgeCount ?? 0,
      rawFileCount: rawResult?.fileCount ?? 0,
      rawSkipped: rawResult?.skipped ?? [],
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
