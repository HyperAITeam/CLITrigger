import fs from 'fs';
import path from 'path';
import * as queries from '../db/queries.js';
import type { MemoryNode, MemoryEdge } from '../db/queries.js';
import { parseWikilinks } from './memory-wikilinks.js';

const RAW_DIR_REL = '.clitrigger/raw';
const DEFAULT_PER_FILE_CHAR_CAP = 50_000;

export type MemoryInjectMode = 'none' | 'all' | 'selected' | 'auto';

export interface MemoryInjectionRequest {
  projectId: string;
  mode: MemoryInjectMode;
  nodeIds?: string[];
  includeEdges?: boolean;
}

export interface MemoryInjectionResult {
  block: string;
  nodeCount: number;
  edgeCount: number;
}

const WIKI_SCHEMA_TAG = '__wiki_schema__';
const WIKI_INDEX_TAG = '__wiki_index__';

function isSystemNode(n: MemoryNode): boolean {
  if (!n.tags) return false;
  try {
    const tags = JSON.parse(n.tags);
    return Array.isArray(tags) && (tags.includes(WIKI_SCHEMA_TAG) || tags.includes(WIKI_INDEX_TAG));
  } catch { return false; }
}

export function buildMemoryBlock(req: MemoryInjectionRequest): MemoryInjectionResult | null {
  if (req.mode === 'none') return null;

  let nodes: MemoryNode[];
  if (req.mode === 'all') {
    // Exclude system nodes (schema, index) — they're meta, not user content.
    nodes = queries.getMemoryNodesByProjectId(req.projectId).filter(n => !isSystemNode(n));
  } else {
    const ids = (req.nodeIds ?? []).filter(Boolean);
    if (ids.length === 0) return null;
    // Project scoping is enforced in SQL — defense in depth against cross-project ID leaks.
    // Selected mode trusts the user's curated picks (allow including schema/index if they want).
    nodes = queries.getMemoryNodesByIds(req.projectId, ids);
  }

  if (nodes.length === 0) return null;

  const edges = req.includeEdges !== false
    ? queries.getMemoryEdgesForNodes(nodes.map(n => n.id))
    : [];

  return {
    block: formatMemoryBlock(nodes, edges),
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

function formatMemoryBlock(nodes: MemoryNode[], edges: MemoryEdge[]): string {
  const lines: string[] = [];
  lines.push('<long_term_memory>');
  lines.push('You have access to the following long-term project memory. Treat each <memory_node> as authoritative reference material curated by the user. Apply it where relevant; you may quote IDs (e.g. "per memory_node:abc123") when explaining decisions, but do not echo entire bodies verbatim unless asked. Wikilinks in the form [[#nodeId:Title]] reference other nodes in this block; an unresolved [[Title]] indicates a node that has not been created yet.');
  lines.push('');

  // Build a project-wide title→id index so wikilinks can be normalized to [[#id:title]]
  const projectId = nodes[0]?.project_id;
  const projectNodes = projectId ? queries.getMemoryNodesByProjectId(projectId) : [];
  const titleIndex = new Map<string, string>();
  for (const pn of projectNodes) {
    titleIndex.set(pn.title.toLowerCase(), pn.id);
  }

  for (const n of nodes) {
    const titleAttr = escapeAttr(n.title);
    const tagsAttr = parseTagsList(n.tags);
    const tagsAttrStr = tagsAttr.length > 0 ? ` tags="${escapeAttr(tagsAttr.join(','))}"` : '';
    lines.push(`<memory_node id="${n.id}" title="${titleAttr}"${tagsAttrStr}>`);
    if (n.body) lines.push(normalizeWikilinks(n.body, titleIndex));
    lines.push('</memory_node>');
  }

  if (edges.length > 0) {
    lines.push('');
    lines.push('<memory_relations>');
    for (const e of edges) {
      const labelPart = e.label ? `: ${e.label}` : '';
      lines.push(`- ${e.from_node_id} --[${e.relation_type}${labelPart}]--> ${e.to_node_id}`);
    }
    lines.push('</memory_relations>');
  }

  lines.push('</long_term_memory>');
  return lines.join('\n');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeWikilinks(body: string, titleIndex: Map<string, string>): string {
  const refs = parseWikilinks(body);
  if (refs.length === 0) return body;
  // Walk the body in order, splicing each match with its resolved/unresolved replacement
  const out: string[] = [];
  let cursor = 0;
  for (const ref of refs) {
    out.push(body.slice(cursor, ref.start));
    const id = titleIndex.get(ref.title.toLowerCase());
    if (id) {
      const aliasPart = ref.alias ? `|${ref.alias}` : '';
      out.push(`[[#${id}:${ref.title}${aliasPart}]]`);
    } else {
      out.push(ref.raw); // leave unresolved as-is (still readable to the LLM)
    }
    cursor = ref.end;
  }
  out.push(body.slice(cursor));
  return out.join('');
}

function parseTagsList(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseMemoryNodeIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function parseRawFilePaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export interface RawFileBlockResult {
  block: string;
  fileCount: number;
  totalChars: number;
  skipped: { path: string; reason: 'outside-raw-dir' | 'missing' | 'read-error' }[];
}

export interface RawFileBlockOptions {
  perFileCharCap?: number;
}

export function buildRawFileBlock(
  projectRoot: string,
  paths: string[],
  opts: RawFileBlockOptions = {},
): RawFileBlockResult | null {
  if (!projectRoot || paths.length === 0) return null;
  const cap = Math.max(500, opts.perFileCharCap ?? DEFAULT_PER_FILE_CHAR_CAP);
  const resolvedRoot = path.resolve(projectRoot);
  const rawRoot = path.resolve(resolvedRoot, RAW_DIR_REL);

  const skipped: RawFileBlockResult['skipped'] = [];
  const items: { path: string; content: string }[] = [];

  for (const rel of paths) {
    const absPath = path.resolve(resolvedRoot, rel);
    if (!absPath.startsWith(rawRoot + path.sep) && absPath !== rawRoot) {
      skipped.push({ path: rel, reason: 'outside-raw-dir' });
      continue;
    }
    if (!fs.existsSync(absPath)) {
      skipped.push({ path: rel, reason: 'missing' });
      continue;
    }
    let content: string;
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) {
        skipped.push({ path: rel, reason: 'missing' });
        continue;
      }
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      skipped.push({ path: rel, reason: 'read-error' });
      continue;
    }
    if (content.length > cap) {
      content = content.slice(0, cap) + '\n[... truncated]';
    }
    items.push({ path: rel.replace(/\\/g, '/'), content });
  }

  if (items.length === 0) {
    return { block: '', fileCount: 0, totalChars: 0, skipped };
  }

  const lines: string[] = [];
  lines.push('<raw_source_files>');
  lines.push('The following are unprocessed source markdown files captured at ingest time. Treat them as primary references — they may contain detail that was condensed out when the wiki nodes were curated. Each <raw_source_file> wraps the verbatim file content.');
  lines.push('');
  let totalChars = 0;
  for (const item of items) {
    const safePath = escapeAttr(item.path);
    lines.push(`<raw_source_file path="${safePath}">`);
    lines.push(item.content);
    lines.push('</raw_source_file>');
    totalChars += item.content.length;
  }
  lines.push('</raw_source_files>');

  return {
    block: lines.join('\n'),
    fileCount: items.length,
    totalChars,
    skipped,
  };
}
