import * as queries from '../db/queries.js';
import type { MemoryNode } from '../db/queries.js';

export const WIKI_INDEX_TAG = '__wiki_index__';
const WIKI_SCHEMA_TAG = '__wiki_schema__';
const INDEX_TITLE = 'Wiki Index';
const SUMMARY_MAX_CHARS = 80;
const UNTAGGED_BUCKET = '_Untagged';

function tagsArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).map(s => s.trim()).filter(Boolean) : [];
  } catch { return []; }
}

export function isWikiIndexNode(n: MemoryNode): boolean {
  return tagsArray(n.tags).includes(WIKI_INDEX_TAG);
}

function isWikiSchemaNode(n: MemoryNode): boolean {
  return tagsArray(n.tags).includes(WIKI_SCHEMA_TAG);
}

function isSystemNode(n: MemoryNode): boolean {
  return isWikiIndexNode(n) || isWikiSchemaNode(n);
}

function firstSentence(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.slice(0, SUMMARY_MAX_CHARS);
  return cut.length < flat.length ? `${cut}…` : cut;
}

function getExistingIndexNode(projectId: string): MemoryNode | undefined {
  const all = queries.getMemoryNodesByProjectId(projectId);
  return all.find(isWikiIndexNode);
}

function buildIndexBody(allNodes: MemoryNode[]): string {
  const visible = allNodes.filter(n => !isSystemNode(n));

  const grouped = new Map<string, MemoryNode[]>();
  for (const n of visible) {
    const tags = tagsArray(n.tags).filter(t => t !== WIKI_INDEX_TAG && t !== WIKI_SCHEMA_TAG);
    const key = tags[0] ?? UNTAGGED_BUCKET;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(n);
  }

  const lines: string[] = [];
  lines.push('# Wiki Index');
  lines.push('');
  lines.push(`_Auto-maintained. ${visible.length} entr${visible.length === 1 ? 'y' : 'ies'} across ${grouped.size} tag${grouped.size === 1 ? '' : 's'}. Last sync: ${new Date().toISOString()}._`);
  lines.push('_Edits to this entry are overwritten on the next wiki change._');
  lines.push('');

  if (visible.length === 0) {
    lines.push('No wiki entries yet — run Ingest to create some.');
    return lines.join('\n') + '\n';
  }

  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
    if (a === UNTAGGED_BUCKET) return 1;
    if (b === UNTAGGED_BUCKET) return -1;
    return a.localeCompare(b);
  });

  for (const [tag, group] of sortedGroups) {
    const sortedGroup = [...group].sort((a, b) => a.title.localeCompare(b.title));
    lines.push(`## ${tag} (${sortedGroup.length})`);
    for (const n of sortedGroup) {
      const summary = firstSentence(n.body || '');
      lines.push(`- [[${n.title}]]${summary ? ` — ${summary}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Upsert the project's auto-maintained index node (`__wiki_index__` tag).
 * Body is a Markdown catalog grouped by first tag, with one-line summaries.
 * Skipped on body equality so wiki-exporter's idempotent writes stay quiet.
 */
export function regenerateIndexNode(projectId: string): MemoryNode | null {
  const project = queries.getProjectById(projectId);
  if (!project) return null;

  const allNodes = queries.getMemoryNodesByProjectId(projectId);
  const visibleCount = allNodes.filter(n => !isSystemNode(n)).length;
  const existing = getExistingIndexNode(projectId);

  // Skip creation when there's nothing to index AND no existing index — avoids
  // creating an empty system node on a fresh project that hasn't ingested yet.
  if (!existing && visibleCount === 0) return null;

  const newBody = buildIndexBody(allNodes);

  if (existing) {
    if (existing.body === newBody) return existing;
    return queries.updateMemoryNode(existing.id, { body: newBody }) ?? existing;
  }

  return queries.createMemoryNode(
    projectId,
    INDEX_TITLE,
    newBody,
    JSON.stringify([WIKI_INDEX_TAG]),
    1, // pinned so it's surfaced near the top in any pinned-aware view
  );
}
