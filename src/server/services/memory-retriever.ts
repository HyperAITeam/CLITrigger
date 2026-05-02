import * as queries from '../db/queries.js';
import type { MemoryNode } from '../db/queries.js';
import { runHeadless, resolveCliTool } from './memory-ingest.js';

const RETRIEVAL_MAX_NODES = 10;
const RETRIEVAL_TIMEOUT_MS = 60_000;
const NODE_LIST_BUDGET_CHARS = 7000;
const TASK_QUERY_MAX_CHARS = 4000;
const WIKI_SCHEMA_TAG = '__wiki_schema__';
const WIKI_INDEX_TAG = '__wiki_index__';

export interface RetrievalResult {
  selectedIds: string[];
  candidateCount: number;
  reason?: 'no-candidates' | 'parse-failed' | 'cli-error' | 'no-match' | 'no-query';
}

function isSystemNode(n: MemoryNode): boolean {
  if (!n.tags) return false;
  try {
    const tags = JSON.parse(n.tags);
    return Array.isArray(tags) && (tags.includes(WIKI_SCHEMA_TAG) || tags.includes(WIKI_INDEX_TAG));
  } catch { return false; }
}

function tagsArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { return []; }
}

function firstSentence(body: string, maxLen = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.slice(0, maxLen);
  return cut.length < flat.length ? `${cut}…` : cut;
}

function buildCandidatePool(nodes: MemoryNode[]): { lines: string[]; idMap: Set<string> } {
  // Pinned first (user-curated importance), then most recently updated.
  const sorted = [...nodes].sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  });

  const lines: string[] = [];
  const idMap = new Set<string>();
  let used = 0;
  for (const n of sorted) {
    const tags = tagsArray(n.tags).filter(t => t !== WIKI_SCHEMA_TAG && t !== WIKI_INDEX_TAG);
    const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    const summary = firstSentence(n.body || '');
    const line = `- id="${n.id}" title="${n.title}"${tagStr}${summary ? ` — ${summary}` : ''}`;
    if (used + line.length > NODE_LIST_BUDGET_CHARS && lines.length > 0) break;
    lines.push(line);
    idMap.add(n.id);
    used += line.length + 1;
  }
  return { lines, idMap };
}

const RETRIEVAL_PROMPT_HEADER = `You are selecting the most relevant wiki entries for an upcoming task. The selected entries will be injected into the task prompt as long-term context.

# Task
{TASK}

# Available wiki entries
{ENTRIES}

---

Output ONLY a JSON array of node IDs (no prose, no code fences):
["id-1", "id-2", ...]

Rules:
- Pick at most ${RETRIEVAL_MAX_NODES} entries directly relevant to the task.
- Prefer fewer high-relevance entries over many tangential ones.
- Return [] if nothing in the wiki is meaningfully relevant — do not pad.`;

function safeParseIdArray(raw: string, validIds: Set<string>): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const ids: string[] = [];
  for (const item of parsed) {
    const id = String(item);
    if (validIds.has(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= RETRIEVAL_MAX_NODES) break;
  }
  return ids;
}

/**
 * One-shot headless LLM call that picks 0–10 relevant wiki node IDs for a given
 * task query. Used by the 'auto' inject mode so we send only relevant context
 * instead of the entire wiki on every run.
 *
 * Failure modes (CLI error, parse failure, empty match) all return an empty
 * selection — caller should treat this as "skip injection" rather than fall
 * back to mode='all' (which would defeat the purpose).
 */
export async function selectRelevantNodes(
  projectId: string,
  taskQuery: string,
): Promise<RetrievalResult> {
  const project = queries.getProjectById(projectId);
  if (!project) return { selectedIds: [], candidateCount: 0, reason: 'no-candidates' };

  const trimmedQuery = (taskQuery || '').trim();
  if (!trimmedQuery) return { selectedIds: [], candidateCount: 0, reason: 'no-query' };

  const candidates = queries.getMemoryNodesByProjectId(projectId).filter(n => !isSystemNode(n));
  if (candidates.length === 0) return { selectedIds: [], candidateCount: 0, reason: 'no-candidates' };

  const { lines, idMap } = buildCandidatePool(candidates);
  if (lines.length === 0) return { selectedIds: [], candidateCount: 0, reason: 'no-candidates' };

  const prompt = RETRIEVAL_PROMPT_HEADER
    .replace('{TASK}', trimmedQuery.slice(0, TASK_QUERY_MAX_CHARS))
    .replace('{ENTRIES}', lines.join('\n'));

  const cliTool = resolveCliTool(project.cli_tool);
  const queryPreview = trimmedQuery.split('\n')[0].slice(0, 80);
  let raw: string;
  try {
    raw = await runHeadless(cliTool, prompt, RETRIEVAL_TIMEOUT_MS);
  } catch (err) {
    console.warn('[memory-retriever] runHeadless failed:', err instanceof Error ? err.message : err);
    try {
      queries.createMemoryLog(projectId, 'retrieve', `Retrieval failed: CLI error (${candidates.length} candidate${candidates.length === 1 ? '' : 's'})`, {
        severity: 'error',
        sourceTitle: queryPreview,
        metadata: { cliTool, candidates: candidates.length, reason: 'cli-error' },
      });
    } catch { /* ignore log failure */ }
    return { selectedIds: [], candidateCount: candidates.length, reason: 'cli-error' };
  }

  const ids = safeParseIdArray(raw, idMap);
  const result: RetrievalResult = ids.length === 0
    ? { selectedIds: [], candidateCount: candidates.length, reason: 'no-match' }
    : { selectedIds: ids, candidateCount: candidates.length };

  try {
    const message = ids.length === 0
      ? `Retrieval picked 0 nodes from ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`
      : `Retrieval picked ${ids.length}/${candidates.length} node${candidates.length === 1 ? '' : 's'}`;
    queries.createMemoryLog(projectId, 'retrieve', message, {
      severity: 'info',
      sourceTitle: queryPreview,
      metadata: { cliTool, candidates: candidates.length, selected: ids.length, ids, reason: result.reason },
    });
  } catch (err) {
    console.warn('[memory-retriever] failed to write memory_logs entry:', err);
  }

  return result;
}
