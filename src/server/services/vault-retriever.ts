import * as queries from '../db/queries.js';
import { scanVault, type VaultFile } from './file-scanner.js';
import { runHeadless, resolveCliTool } from './memory-ingest.js';

const RETRIEVAL_MAX_FILES = 10;
const RETRIEVAL_TIMEOUT_MS = 60_000;
const FILE_LIST_BUDGET_CHARS = 7000;
const TASK_QUERY_MAX_CHARS = 4000;

export interface VaultRetrievalResult {
  selectedPaths: string[];
  candidateCount: number;
  reason?: 'no-candidates' | 'parse-failed' | 'cli-error' | 'no-match' | 'no-query';
}

function firstSentence(text: string, maxLen = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.slice(0, maxLen);
  return cut.length < flat.length ? `${cut}…` : cut;
}

function buildCandidatePool(files: VaultFile[]): { lines: string[]; pathSet: Set<string> } {
  const sorted = [...files].sort((a, b) =>
    (b.mtime ?? '').localeCompare(a.mtime ?? '')
  );

  const lines: string[] = [];
  const pathSet = new Set<string>();
  let used = 0;
  for (const f of sorted) {
    const tagStr = f.tags.length > 0 ? ` [${f.tags.join(', ')}]` : '';
    const summary = firstSentence(f.bodyPreview);
    const line = `- path="${f.relativePath}" title="${f.title}"${tagStr}${summary ? ` — ${summary}` : ''}`;
    if (used + line.length > FILE_LIST_BUDGET_CHARS && lines.length > 0) break;
    lines.push(line);
    pathSet.add(f.relativePath);
    used += line.length + 1;
  }
  return { lines, pathSet };
}

const RETRIEVAL_PROMPT_HEADER = `You are selecting the most relevant wiki files for an upcoming task. The selected files will be injected into the task prompt as long-term context.

# Task
{TASK}

# Available wiki files
{ENTRIES}

---

Output ONLY a JSON array of file paths (no prose, no code fences):
["path/to/file1.md", "path/to/file2.md"]

Rules:
- Pick at most ${RETRIEVAL_MAX_FILES} files directly relevant to the task.
- Prefer fewer high-relevance files over many tangential ones.
- Return [] if nothing is meaningfully relevant — do not pad.`;

function safeParsePathArray(raw: string, validPaths: Set<string>): string[] {
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
  const paths: string[] = [];
  for (const item of parsed) {
    const p = String(item);
    if (validPaths.has(p) && !paths.includes(p)) paths.push(p);
    if (paths.length >= RETRIEVAL_MAX_FILES) break;
  }
  return paths;
}

export async function selectRelevantFiles(
  projectId: string,
  projectRoot: string,
  taskQuery: string,
  excludePatterns?: string[],
): Promise<VaultRetrievalResult> {
  const project = queries.getProjectById(projectId);
  if (!project) return { selectedPaths: [], candidateCount: 0, reason: 'no-candidates' };

  const trimmedQuery = (taskQuery || '').trim();
  if (!trimmedQuery) return { selectedPaths: [], candidateCount: 0, reason: 'no-query' };

  const candidates = scanVault(projectRoot, excludePatterns);
  if (candidates.length === 0) return { selectedPaths: [], candidateCount: 0, reason: 'no-candidates' };

  const { lines, pathSet } = buildCandidatePool(candidates);
  if (lines.length === 0) return { selectedPaths: [], candidateCount: 0, reason: 'no-candidates' };

  const prompt = RETRIEVAL_PROMPT_HEADER
    .replace('{TASK}', trimmedQuery.slice(0, TASK_QUERY_MAX_CHARS))
    .replace('{ENTRIES}', lines.join('\n'));

  const cliTool = resolveCliTool(project.cli_tool);
  let raw: string;
  try {
    raw = await runHeadless(cliTool, prompt, RETRIEVAL_TIMEOUT_MS);
  } catch (err) {
    console.warn('[vault-retriever] runHeadless failed:', err instanceof Error ? err.message : err);
    return { selectedPaths: [], candidateCount: candidates.length, reason: 'cli-error' };
  }

  const paths = safeParsePathArray(raw, pathSet);
  return paths.length === 0
    ? { selectedPaths: [], candidateCount: candidates.length, reason: 'no-match' }
    : { selectedPaths: paths, candidateCount: candidates.length };
}
