import fs from 'fs';
import path from 'path';
import * as queries from '../db/queries.js';
import type { MemoryNode, MemoryEdge } from '../db/queries.js';
import { getSetting, setSetting } from '../db/app-settings.js';

// The DB-backed wiki was retired in favour of plain vault documents. Wiki
// nodes are written out once per project as md files under .clitrigger/wiki/
// (the layout the old one-way export used); from then on the files are the
// source of truth. The memory_* tables are left in place, untouched.

const WIKI_SCHEMA_TAG = '__wiki_schema__';
const WIKI_INDEX_TAG = '__wiki_index__';
const UNTAGGED_BUCKET = '_untagged';
const MAX_SLUG_LEN = 60;
const OLD_README_HEADING = '# Project Wiki (auto-generated)';

function tagsArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).map(s => s.trim()).filter(Boolean) : [];
  } catch { return []; }
}

const isSchemaNode = (n: MemoryNode) => tagsArray(n.tags).includes(WIKI_SCHEMA_TAG);
const isIndexNode = (n: MemoryNode) => tagsArray(n.tags).includes(WIKI_INDEX_TAG);
const userTags = (n: MemoryNode) => tagsArray(n.tags).filter(t => t !== WIKI_SCHEMA_TAG && t !== WIKI_INDEX_TAG);

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
  if (isSchemaNode(n) || isIndexNode(n)) return '';
  const tags = userTags(n);
  return tags.length === 0 ? UNTAGGED_BUCKET : slugify(tags[0]) || UNTAGGED_BUCKET;
}

function filenameForNode(n: MemoryNode): string {
  if (isSchemaNode(n)) return '_schema.md';
  if (isIndexNode(n)) return '_index.md';
  return `${slugify(n.title)}.md`;
}

function escapeYamlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface EdgeSummary {
  outgoing: { to: string; to_id: string; type: string; label: string | null }[];
  incoming: { from: string; from_id: string; type: string; label: string | null }[];
}

function buildEdgeIndex(nodes: MemoryNode[], edges: MemoryEdge[]): Map<string, EdgeSummary> {
  const idToTitle = new Map(nodes.map(n => [n.id, n.title]));
  const result = new Map<string, EdgeSummary>(nodes.map(n => [n.id, { outgoing: [], incoming: [] }]));
  for (const e of edges) {
    const fromTitle = idToTitle.get(e.from_node_id);
    const toTitle = idToTitle.get(e.to_node_id);
    if (!fromTitle || !toTitle) continue;
    result.get(e.from_node_id)?.outgoing.push({ to: toTitle, to_id: e.to_node_id, type: e.relation_type, label: e.label });
    result.get(e.to_node_id)?.incoming.push({ from: fromTitle, from_id: e.from_node_id, type: e.relation_type, label: e.label });
  }
  return result;
}

function renderNodeMarkdown(n: MemoryNode, edges: EdgeSummary): string {
  const lines: string[] = ['---', `id: ${n.id}`, `title: ${escapeYamlString(n.title)}`];
  const tags = userTags(n);
  if (tags.length > 0) lines.push(`tags: [${tags.map(escapeYamlString).join(', ')}]`);
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
        lines.push(`    - to: ${escapeYamlString(e.to)}`, `      to_id: ${e.to_id}`, `      type: ${e.type}`);
        if (e.label) lines.push(`      label: ${escapeYamlString(e.label)}`);
      }
    }
    if (edges.incoming.length > 0) {
      lines.push('  incoming:');
      for (const e of edges.incoming) {
        lines.push(`    - from: ${escapeYamlString(e.from)}`, `      from_id: ${e.from_id}`, `      type: ${e.type}`);
        if (e.label) lines.push(`      label: ${escapeYamlString(e.label)}`);
      }
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n\n# ${n.title}\n\n${n.body ?? ''}\n`;
}

/** Same `<bucket>/<slug>.md` → the older node keeps the clean name, later ones get `-{shortId}`. */
function assignPaths(nodes: MemoryNode[]): Map<string, string> {
  const byPath = new Map<string, MemoryNode[]>();
  for (const n of nodes) {
    const key = path.join(bucketForNode(n), filenameForNode(n));
    byPath.set(key, [...(byPath.get(key) ?? []), n]);
  }
  const result = new Map<string, string>();
  for (const [key, group] of byPath) {
    const sorted = [...group].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));
    sorted.forEach((n, i) => result.set(n.id, i === 0 ? key : key.replace(/\.md$/, `-${n.id.slice(0, 8)}.md`)));
  }
  return result;
}

/** Write every wiki node that has no file yet. Never overwrites or deletes a file. */
export function migrateProjectWiki(projectId: string, projectPath: string): number {
  const nodes = queries.getMemoryNodesByProjectId(projectId);
  if (nodes.length === 0) return 0;
  const baseDir = path.resolve(projectPath, '.clitrigger', 'wiki');
  const edgeIndex = buildEdgeIndex(nodes, queries.getMemoryEdgesByProjectId(projectId));
  const paths = assignPaths(nodes);
  let written = 0;
  for (const n of nodes) {
    const filePath = path.resolve(baseDir, paths.get(n.id)!);
    if (!filePath.startsWith(baseDir + path.sep) || fs.existsSync(filePath)) continue;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, renderNodeMarkdown(n, edgeIndex.get(n.id)!), 'utf-8');
    written++;
  }
  // The old README said the folder is regenerated from the DB — no longer true.
  const readme = path.join(baseDir, 'README.md');
  try {
    if (fs.readFileSync(readme, 'utf-8').startsWith(OLD_README_HEADING)) fs.unlinkSync(readme);
  } catch { /* absent */ }
  return written;
}

/** Startup hook: migrate each project once. Unreachable paths retry on a later start. */
export function migrateAllProjectWikis(): void {
  for (const project of queries.getAllProjects()) {
    const key = `wiki.migrated.${project.id}`;
    if (getSetting(key) || !project.path || !fs.existsSync(project.path)) continue;
    try {
      const written = migrateProjectWiki(project.id, project.path);
      if (written > 0) console.log(`[wiki-migration] ${project.name}: wrote ${written} wiki file(s) to .clitrigger/wiki`);
      setSetting(key, '1');
    } catch (err) {
      console.warn(`[wiki-migration] ${project.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
