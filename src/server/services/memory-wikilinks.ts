import * as queries from '../db/queries.js';
import type { MemoryNode } from '../db/queries.js';

export interface WikilinkRef {
  raw: string;
  title: string;
  alias?: string;
  start: number;
  end: number;
}

const WIKILINK_PATTERN = /\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|([^\]\n]+))?\]\]/g;

export function parseWikilinks(body: string): WikilinkRef[] {
  if (!body) return [];
  const refs: WikilinkRef[] = [];
  WIKILINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_PATTERN.exec(body)) !== null) {
    const title = match[1].trim();
    if (!title) continue;
    refs.push({
      raw: match[0],
      title,
      alias: match[2]?.trim() || undefined,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return refs;
}

export interface ResolvedWikilink {
  title: string;
  nodeId: string | null;
}

export function resolveWikilinks(projectId: string, titles: string[]): ResolvedWikilink[] {
  const seen = new Set<string>();
  const results: ResolvedWikilink[] = [];
  for (const title of titles) {
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const node = queries.getMemoryNodeByTitle(projectId, title);
    results.push({ title, nodeId: node?.id ?? null });
  }
  return results;
}

/**
 * Replace `[[oldTitle]]` (case-insensitive title match) with `[[newTitle]]`,
 * preserving any alias (`|alias`) or heading (`#section`) suffix the user wrote.
 */
export function replaceTitleInBody(body: string, oldTitle: string, newTitle: string): string {
  if (!body) return body;
  const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[\\s*${escaped}\\s*((?:#[^\\]\\n|]+)?(?:\\|[^\\]\\n]+)?)\\]\\]`, 'gi');
  return body.replace(re, (_full, suffix: string) => `[[${newTitle}${suffix ?? ''}]]`);
}

/**
 * Find every node whose body references `targetTitle` via `[[targetTitle]]`,
 * returning the source node + a 60-char snippet around the first match.
 */
export interface BacklinkHit {
  source: MemoryNode;
  snippet: string;
}

export function findBacklinks(projectId: string, targetTitle: string, excludeNodeId?: string): BacklinkHit[] {
  const all = queries.getMemoryNodesByProjectId(projectId);
  const hits: BacklinkHit[] = [];
  const lowerTarget = targetTitle.toLowerCase();
  for (const node of all) {
    if (node.id === excludeNodeId) continue;
    if (!node.body) continue;
    const refs = parseWikilinks(node.body);
    const ref = refs.find(r => r.title.toLowerCase() === lowerTarget);
    if (!ref) continue;
    hits.push({ source: node, snippet: buildSnippet(node.body, ref.start, ref.end) });
  }
  return hits;
}

function buildSnippet(body: string, start: number, end: number, radius = 30): string {
  const left = Math.max(0, start - radius);
  const right = Math.min(body.length, end + radius);
  const slice = body.slice(left, right).replace(/\s+/g, ' ').trim();
  const prefix = left > 0 ? '…' : '';
  const suffix = right < body.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}

/**
 * Append `[[targetTitle]]` to the end of an existing body, separated by a blank line
 * so it doesn't accidentally fuse with prior markdown. If the link already exists, no-op.
 */
export function appendWikilinkToBody(body: string, targetTitle: string): string {
  const refs = parseWikilinks(body);
  const exists = refs.some(r => r.title.toLowerCase() === targetTitle.toLowerCase());
  if (exists) return body;
  const link = `[[${targetTitle}]]`;
  if (!body.trim()) return link;
  return `${body.trimEnd()}\n\n${link}`;
}
