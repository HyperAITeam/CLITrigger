import fs from 'fs';
import path from 'path';
import * as queries from '../db/queries.js';
import type { MemoryNode, MemoryEdge } from '../db/queries.js';
import { regenerateIndexNode, WIKI_INDEX_TAG } from './wiki-index.js';

const WIKI_DIR_NAME = '.clitrigger';
const WIKI_SUBDIR = 'wiki';
const WIKI_SCHEMA_TAG = '__wiki_schema__';
const UNTAGGED_BUCKET = '_untagged';
const SCHEMA_FILENAME = '_schema.md';
const INDEX_FILENAME = '_index.md';
const MAX_SLUG_LEN = 60;

function isSchemaNode(n: MemoryNode): boolean {
  if (!n.tags) return false;
  try {
    const tags = JSON.parse(n.tags);
    return Array.isArray(tags) && tags.includes(WIKI_SCHEMA_TAG);
  } catch { return false; }
}

function isIndexNode(n: MemoryNode): boolean {
  if (!n.tags) return false;
  try {
    const tags = JSON.parse(n.tags);
    return Array.isArray(tags) && tags.includes(WIKI_INDEX_TAG);
  } catch { return false; }
}

function tagsArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).map(s => s.trim()).filter(Boolean) : [];
  } catch { return []; }
}

function slugify(input: string): string {
  if (!input) return 'untitled';
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase()
    .slice(0, MAX_SLUG_LEN);
  return cleaned || 'untitled';
}

function bucketForNode(n: MemoryNode): string {
  if (isSchemaNode(n) || isIndexNode(n)) return ''; // root
  const tags = tagsArray(n.tags).filter(t => t !== WIKI_SCHEMA_TAG && t !== WIKI_INDEX_TAG);
  if (tags.length === 0) return UNTAGGED_BUCKET;
  return slugify(tags[0]) || UNTAGGED_BUCKET;
}

function filenameForNode(n: MemoryNode): string {
  if (isSchemaNode(n)) return SCHEMA_FILENAME;
  if (isIndexNode(n)) return INDEX_FILENAME;
  return `${slugify(n.title)}.md`;
}

function escapeYamlString(s: string): string {
  // Use double-quoted YAML strings; escape backslash and double-quote.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface EdgeSummary {
  outgoing: { to: string; to_id: string; type: string; label: string | null }[];
  incoming: { from: string; from_id: string; type: string; label: string | null }[];
}

function buildEdgeIndex(nodes: MemoryNode[], edges: MemoryEdge[]): Map<string, EdgeSummary> {
  const idToTitle = new Map<string, string>();
  for (const n of nodes) idToTitle.set(n.id, n.title);
  const result = new Map<string, EdgeSummary>();
  for (const n of nodes) result.set(n.id, { outgoing: [], incoming: [] });
  for (const e of edges) {
    const fromTitle = idToTitle.get(e.from_node_id);
    const toTitle = idToTitle.get(e.to_node_id);
    if (!fromTitle || !toTitle) continue;
    const fromBucket = result.get(e.from_node_id);
    const toBucket = result.get(e.to_node_id);
    if (fromBucket) fromBucket.outgoing.push({ to: toTitle, to_id: e.to_node_id, type: e.relation_type, label: e.label });
    if (toBucket) toBucket.incoming.push({ from: fromTitle, from_id: e.from_node_id, type: e.relation_type, label: e.label });
  }
  return result;
}

function renderFrontmatter(n: MemoryNode, edges: EdgeSummary): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${n.id}`);
  lines.push(`title: ${escapeYamlString(n.title)}`);
  const tags = tagsArray(n.tags).filter(t => t !== WIKI_SCHEMA_TAG && t !== WIKI_INDEX_TAG);
  if (tags.length > 0) {
    lines.push(`tags: [${tags.map(escapeYamlString).join(', ')}]`);
  }
  if (isSchemaNode(n)) lines.push('schema: true');
  if (isIndexNode(n)) lines.push('index: true');
  if (n.pinned) lines.push('pinned: true');
  lines.push(`created_at: ${escapeYamlString(n.created_at)}`);
  lines.push(`updated_at: ${escapeYamlString(n.updated_at)}`);
  if (n.source_type) lines.push(`source_type: ${escapeYamlString(n.source_type)}`);
  if (n.source_id) lines.push(`source_id: ${escapeYamlString(n.source_id)}`);
  if (n.source_path) lines.push(`source_path: ${escapeYamlString(n.source_path)}`);

  if (edges.outgoing.length > 0 || edges.incoming.length > 0) {
    lines.push('edges:');
    if (edges.outgoing.length > 0) {
      lines.push('  outgoing:');
      for (const e of edges.outgoing) {
        lines.push(`    - to: ${escapeYamlString(e.to)}`);
        lines.push(`      to_id: ${e.to_id}`);
        lines.push(`      type: ${e.type}`);
        if (e.label) lines.push(`      label: ${escapeYamlString(e.label)}`);
      }
    }
    if (edges.incoming.length > 0) {
      lines.push('  incoming:');
      for (const e of edges.incoming) {
        lines.push(`    - from: ${escapeYamlString(e.from)}`);
        lines.push(`      from_id: ${e.from_id}`);
        lines.push(`      type: ${e.type}`);
        if (e.label) lines.push(`      label: ${escapeYamlString(e.label)}`);
      }
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function renderNodeMarkdown(n: MemoryNode, edges: EdgeSummary): string {
  const fm = renderFrontmatter(n, edges);
  const body = n.body ?? '';
  const heading = `# ${n.title}`;
  return `${fm}\n\n${heading}\n\n${body}\n`;
}

/**
 * Resolve a slug collision: if two nodes produce the same `<bucket>/<slug>.md`,
 * append `-{shortId}` to the second's filename. We sort by created_at so the
 * "older" node keeps the cleaner name.
 */
function assignFilenames(nodes: MemoryNode[]): Map<string, { bucket: string; filename: string }> {
  const bySlug = new Map<string, MemoryNode[]>();
  for (const n of nodes) {
    const key = `${bucketForNode(n)}/${filenameForNode(n)}`;
    const list = bySlug.get(key);
    if (list) list.push(n);
    else bySlug.set(key, [n]);
  }
  const result = new Map<string, { bucket: string; filename: string }>();
  for (const [, group] of bySlug) {
    if (group.length === 1) {
      const n = group[0];
      result.set(n.id, { bucket: bucketForNode(n), filename: filenameForNode(n) });
      continue;
    }
    // Stable sort: oldest first keeps clean name, others get suffixed.
    const sorted = [...group].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));
    sorted.forEach((n, i) => {
      const bucket = bucketForNode(n);
      const baseFile = filenameForNode(n);
      if (i === 0) {
        result.set(n.id, { bucket, filename: baseFile });
      } else {
        const stem = baseFile.replace(/\.md$/, '');
        const shortId = n.id.slice(0, 8);
        result.set(n.id, { bucket, filename: `${stem}-${shortId}.md` });
      }
    });
  }
  return result;
}

function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  }
  return out;
}

function writeReadme(baseDir: string): void {
  const readmePath = path.join(baseDir, 'README.md');
  if (fs.existsSync(readmePath)) return;
  const content = `# Project Wiki (auto-generated)

This directory is a one-way Markdown mirror of the wiki nodes stored in
CLITrigger's database. The application regenerates these files whenever
wiki content changes — **edits made directly to files here are
overwritten on the next sync.**

To track this directory in git, ensure your \`.gitignore\` ignores only
\`.clitrigger/raw/\` (the raw source snapshots) rather than the entire
\`.clitrigger/\` directory.

Layout:
- \`<entity-type>/<slug>.md\` — one file per wiki node, grouped by first tag
- \`_untagged/\` — nodes with no tags
- \`_schema.md\` — the wiki schema (entity types + ingest conventions)
`;
  try {
    fs.writeFileSync(readmePath, content, 'utf-8');
  } catch { /* non-fatal */ }
}

export interface ExportResult {
  baseDir: string;
  written: number;
  removed: number;
  removedDirs: number;
}

export function exportProjectWikiSync(projectId: string): ExportResult | null {
  const project = queries.getProjectById(projectId);
  if (!project || !project.path) return null;
  if (!fs.existsSync(project.path)) return null;

  const baseDir = path.join(project.path, WIKI_DIR_NAME, WIKI_SUBDIR);
  fs.mkdirSync(baseDir, { recursive: true });
  writeReadme(baseDir);

  // Refresh the auto-maintained index node before reading the snapshot so the
  // exported _index.md and the in-DB index stay in sync.
  try { regenerateIndexNode(projectId); } catch (err) {
    console.warn('[wiki-exporter] index regeneration failed:', err instanceof Error ? err.message : err);
  }

  const nodes = queries.getMemoryNodesByProjectId(projectId);
  const edges = queries.getMemoryEdgesByProjectId(projectId);
  const edgeIndex = buildEdgeIndex(nodes, edges);
  const filenameMap = assignFilenames(nodes);

  const expected = new Set<string>();
  let written = 0;

  for (const n of nodes) {
    const placement = filenameMap.get(n.id);
    if (!placement) continue;
    const subDir = placement.bucket ? path.join(baseDir, placement.bucket) : baseDir;
    fs.mkdirSync(subDir, { recursive: true });
    const filePath = path.join(subDir, placement.filename);
    // Path traversal guard
    const resolved = path.resolve(filePath);
    const resolvedBase = path.resolve(baseDir);
    if (!resolved.startsWith(resolvedBase + path.sep)) continue;

    const summary = edgeIndex.get(n.id) ?? { outgoing: [], incoming: [] };
    const content = renderNodeMarkdown(n, summary);
    try {
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
      if (existing !== content) {
        fs.writeFileSync(filePath, content, 'utf-8');
      }
      expected.add(resolved);
      written++;
    } catch (err) {
      console.warn('[wiki-exporter] write failed:', err);
    }
  }

  // Cleanup orphaned files (deleted nodes, renamed slugs, etc.)
  let removed = 0;
  const existingFiles = walkMarkdownFiles(baseDir);
  for (const file of existingFiles) {
    const resolved = path.resolve(file);
    if (path.basename(resolved) === 'README.md') continue;
    if (!expected.has(resolved)) {
      try {
        fs.unlinkSync(resolved);
        removed++;
      } catch { /* ignore */ }
    }
  }

  // Cleanup empty bucket directories
  let removedDirs = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch { entries = []; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(baseDir, entry.name);
    try {
      const inner = fs.readdirSync(dirPath);
      if (inner.length === 0) {
        fs.rmdirSync(dirPath);
        removedDirs++;
      }
    } catch { /* ignore */ }
  }

  return { baseDir, written, removed, removedDirs };
}

export interface DiskDiffEntry {
  type: 'modified' | 'missing' | 'untracked';
  /** Path relative to the wiki/ root, e.g. "Feature/foo.md". */
  filename: string;
  /** Node ID for modified/missing entries (untracked files have no DB pair). */
  id?: string;
  title?: string;
  diskBytes?: number;
  dbBytes?: number;
}

/**
 * Read-only comparison of `<project>/.clitrigger/wiki/` files against what
 * `exportProjectWikiSync` would currently emit. Used by the "Check for disk
 * changes" UI so users can spot edits made in Obsidian (or anything else)
 * without committing to a bidirectional sync that risks losing in-flight
 * work. Caller decides what to do — apply, ignore, or re-export to overwrite.
 */
export function diffProjectWikiSync(projectId: string): DiskDiffEntry[] | null {
  const project = queries.getProjectById(projectId);
  if (!project || !project.path) return null;
  const baseDir = path.join(project.path, WIKI_DIR_NAME, WIKI_SUBDIR);
  if (!fs.existsSync(baseDir)) return [];

  // Refresh the index so it doesn't show as "modified" just because we haven't
  // exported recently. This is read-only as far as the disk is concerned.
  try { regenerateIndexNode(projectId); } catch { /* ignore */ }

  const nodes = queries.getMemoryNodesByProjectId(projectId);
  const edges = queries.getMemoryEdgesByProjectId(projectId);
  const edgeIndex = buildEdgeIndex(nodes, edges);
  const filenameMap = assignFilenames(nodes);

  interface Expected { node: MemoryNode; content: string; relativeKey: string; absPath: string; }
  const expectedByAbs = new Map<string, Expected>();
  for (const n of nodes) {
    const placement = filenameMap.get(n.id);
    if (!placement) continue;
    const subDir = placement.bucket ? path.join(baseDir, placement.bucket) : baseDir;
    const filePath = path.join(subDir, placement.filename);
    const absPath = path.resolve(filePath);
    const summary = edgeIndex.get(n.id) ?? { outgoing: [], incoming: [] };
    expectedByAbs.set(absPath, {
      node: n,
      content: renderNodeMarkdown(n, summary),
      relativeKey: placement.bucket ? `${placement.bucket}/${placement.filename}` : placement.filename,
      absPath,
    });
  }

  const diffs: DiskDiffEntry[] = [];
  const seenOnDisk = new Set<string>();

  for (const file of walkMarkdownFiles(baseDir)) {
    if (path.basename(file) === 'README.md') continue;
    const abs = path.resolve(file);
    seenOnDisk.add(abs);
    const exp = expectedByAbs.get(abs);
    const relativeKey = path.relative(baseDir, file).split(path.sep).join('/');
    if (!exp) {
      let bytes = 0;
      try { bytes = fs.statSync(file).size; } catch { /* ignore */ }
      diffs.push({ type: 'untracked', filename: relativeKey, diskBytes: bytes });
      continue;
    }
    let onDisk: string;
    try { onDisk = fs.readFileSync(file, 'utf-8'); } catch { continue; }
    if (onDisk !== exp.content) {
      diffs.push({
        type: 'modified',
        filename: exp.relativeKey,
        id: exp.node.id,
        title: exp.node.title,
        diskBytes: onDisk.length,
        dbBytes: exp.content.length,
      });
    }
  }

  for (const [abs, exp] of expectedByAbs) {
    if (!seenOnDisk.has(abs)) {
      diffs.push({
        type: 'missing',
        filename: exp.relativeKey,
        id: exp.node.id,
        title: exp.node.title,
        dbBytes: exp.content.length,
      });
    }
  }

  return diffs;
}

/**
 * Best-effort wiki export. Errors are swallowed so callers can fire-and-forget
 * after any wiki mutation without worrying about blocking the response or
 * breaking the request on FS issues.
 */
export function dispatchWikiExport(projectId: string): void {
  // Defer to next tick so we don't add latency to the triggering request.
  setImmediate(() => {
    try {
      exportProjectWikiSync(projectId);
    } catch (err) {
      console.warn('[wiki-exporter] dispatch failed:', err instanceof Error ? err.message : err);
    }
  });
}
