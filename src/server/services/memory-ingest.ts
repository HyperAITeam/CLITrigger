import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as queries from '../db/queries.js';
import type { CliTool } from './cli-adapters.js';

const RAW_DIR_NAME = '.clitrigger';
const RAW_SUBDIR = 'raw';
const VALID_SOURCE_TYPES = new Set(['todo', 'discussion', 'manual']);

function ensureGitignore(projectPath: string, entry: string): void {
  const gitignorePath = path.join(projectPath, '.gitignore');
  try {
    const content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    const lines = content.split(/\r?\n/);
    if (!lines.some(l => l.trim() === entry)) {
      const newline = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(gitignorePath, `${newline}${entry}\n`);
    }
  } catch {
    // Non-fatal
  }
}

function slugify(input: string, maxLen = 40): string {
  if (!input) return 'untitled';
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLen);
  return cleaned || 'untitled';
}

function timestampStr(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Write the raw source text to <projectPath>/.clitrigger/raw/<sourceType>/<file>.md
 * and return the project-relative path. Returns null on failure (non-fatal).
 */
function writeRawSnapshot(
  project: queries.Project,
  sourceType: string,
  sourceId: string | null,
  fullText: string,
  titleHint: string,
): string | null {
  if (!VALID_SOURCE_TYPES.has(sourceType)) return null;
  if (!project.path) return null;
  try {
    const baseDir = path.join(project.path, RAW_DIR_NAME, RAW_SUBDIR, sourceType);
    fs.mkdirSync(baseDir, { recursive: true });
    ensureGitignore(project.path, `${RAW_DIR_NAME}/`);

    const ts = timestampStr();
    const idPart = sourceId ? `-${sourceId.slice(0, 8)}` : '';
    const slug = slugify(titleHint || sourceType);
    const filename = `${ts}${idPart}-${slug}.md`;
    const filePath = path.join(baseDir, filename);

    // Defensive: ensure final resolved path is still inside baseDir
    const resolvedFinal = path.resolve(filePath);
    const resolvedBase = path.resolve(baseDir);
    if (!resolvedFinal.startsWith(resolvedBase + path.sep) && resolvedFinal !== resolvedBase) {
      return null;
    }

    fs.writeFileSync(filePath, fullText, 'utf-8');
    const rel = path.relative(project.path, filePath).split(path.sep).join('/');
    return rel;
  } catch (err) {
    console.warn('[memory-ingest] writeRawSnapshot failed:', err);
    return null;
  }
}

const DEFAULT_WIKI_SCHEMA = `# Wiki Schema

## Entity Types
- **Feature** — product capabilities and implemented behaviors
- **Decision** — architectural/design choices with rationale
- **Bug** — known issues, root causes, and workarounds
- **Pattern** — reusable code/design patterns
- **Concept** — domain knowledge and terminology

## Conventions
- Titles: short noun phrases (≤60 chars)
- Body: 2-5 sentences, factual, no filler
- **Use [[Title]] wikilinks liberally inside body text** — every time the body mentions another node by name, wrap it as [[Title]]. This is the primary way connections are made.
- Tags: first tag should be the entity type
- Prefer updating existing nodes over creating new duplicates
- Connections are the value of a wiki — a node with no inbound or outbound links is nearly useless. Always relate new entries to existing ones.`;

const WIKI_SCHEMA_TAG = '__wiki_schema__';

export interface IngestSkippedBreakdown {
  parseFailed: boolean;
  proposedCreate: number;
  proposedUpdate: number;
  proposedEdges: number;
  duplicateTitle: number;
  uniqueConflict: number;
  emptyTitle: number;
  invalidUpdateId: number;
  invalidEdgeRef: number;
  selfEdge: number;
  edgeUniqueConflict: number;
}

export interface IngestResult {
  created: number;
  updated: number;
  edgesAdded: number;
  nodeIds: string[];
  skipped: IngestSkippedBreakdown;
  rawResponseSnippet?: string;
}

export interface LintIssue {
  type: 'contradiction' | 'orphan' | 'duplicate' | 'stale';
  node_titles: string[];
  message: string;
}

interface IngestOp {
  create: { title: string; body: string; tags?: string[] }[];
  update: { id: string; title?: string; body?: string; tags?: string[] }[];
  edges: { from_title: string; to_title: string; relation_type?: string; label?: string }[];
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : trimmed;
}

function safeParseIngestOp(raw: string): { op: IngestOp; parseFailed: boolean } {
  const empty: IngestOp = { create: [], update: [], edges: [] };
  const cleaned = stripCodeFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return { op: empty, parseFailed: true };
    try { parsed = JSON.parse(m[0]); } catch { return { op: empty, parseFailed: true }; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { op: empty, parseFailed: true };
  }
  const p = parsed as Record<string, unknown>;
  const create = Array.isArray(p.create) ? p.create : [];
  const update = Array.isArray(p.update) ? p.update : [];
  const edges = Array.isArray(p.edges) ? p.edges : [];
  return { op: { create, update, edges }, parseFailed: false };
}

function safeParseLintIssues(raw: string): LintIssue[] {
  const cleaned = stripCodeFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try { parsed = JSON.parse(m[0]); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const valid = ['contradiction', 'orphan', 'duplicate', 'stale'];
  return parsed
    .filter((e): e is Record<string, unknown> => e && typeof e === 'object')
    .filter(e => valid.includes(String(e.type)))
    .map(e => ({
      type: e.type as LintIssue['type'],
      node_titles: Array.isArray(e.node_titles) ? e.node_titles.map(String) : [],
      message: typeof e.message === 'string' ? e.message.trim() : '',
    }))
    .filter(e => e.message)
    .slice(0, 10);
}

function buildInvocation(cliTool: CliTool): { command: string; args: string[] } {
  switch (cliTool) {
    case 'gemini': return { command: 'gemini', args: ['--yolo', '--prompt='] };
    case 'codex': return { command: 'codex', args: ['exec'] };
    case 'claude':
    default: return { command: 'claude', args: ['--print'] };
  }
}

function runHeadless(cliTool: CliTool, prompt: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const { command, args } = buildInvocation(cliTool);
    const isWin = process.platform === 'win32';
    const spawnCmd = isWin ? 'cmd.exe' : command;
    const spawnArgs = isWin ? ['/c', command, ...args] : args;

    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: process.env.HOME || process.env.USERPROFILE || '.',
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch { /* ignore */ }
      reject(new Error('Memory ingest timed out'));
    }, timeoutMs);

    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`CLI exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
    });

    try {
      proc.stdin.write(prompt + '\n');
      proc.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function resolveCliTool(value: unknown): CliTool {
  if (value === 'claude' || value === 'gemini' || value === 'codex') return value;
  return 'claude';
}

function getOrCreateSchemaNode(projectId: string): string {
  const all = queries.getMemoryNodesByProjectId(projectId);
  const existing = all.find(n => {
    try {
      const tags = JSON.parse(n.tags ?? '[]');
      return Array.isArray(tags) && tags.includes(WIKI_SCHEMA_TAG);
    } catch { return false; }
  });
  if (existing) return existing.body || DEFAULT_WIKI_SCHEMA;
  queries.createMemoryNode(
    projectId,
    'Wiki Schema',
    DEFAULT_WIKI_SCHEMA,
    JSON.stringify([WIKI_SCHEMA_TAG]),
    1,
  );
  return DEFAULT_WIKI_SCHEMA;
}

function buildNodeSummary(nodes: queries.MemoryNode[]): string {
  const visible = nodes.filter(n => {
    try {
      const tags = JSON.parse(n.tags ?? '[]');
      return !Array.isArray(tags) || !tags.includes(WIKI_SCHEMA_TAG);
    } catch { return true; }
  });
  if (visible.length === 0) return '(no existing pages)';
  return visible.map(n => {
    try {
      const tags: string[] = JSON.parse(n.tags ?? '[]');
      const tagStr = tags.filter(t => t !== WIKI_SCHEMA_TAG).join(', ');
      const pinned = n.pinned ? ' [pinned]' : '';
      const bodyPreview = n.pinned ? `\n  ${(n.body || '').slice(0, 300)}` : '';
      return `- id="${n.id}" title="${n.title}"${tagStr ? ` tags=[${tagStr}]` : ''}${pinned}${bodyPreview}`;
    } catch {
      return `- id="${n.id}" title="${n.title}"`;
    }
  }).join('\n');
}

const INGEST_PROMPT_HEADER = `You are maintaining a project knowledge wiki using the LLM Wiki pattern.

## Wiki Schema
{SCHEMA}

## Existing Wiki Pages
{NODES}

## New Source Material
{SOURCE}

---

Analyze the source material and output ONLY a JSON object (no prose, no code fences):
{
  "create": [{"title": "string", "body": "string", "tags": ["string"]}],
  "update": [{"id": "string", "body": "string", "tags": ["string"]}],
  "edges": [{"from_title": "string", "to_title": "string", "relation_type": "related", "label": "string"}]
}

Rules:
- 0-10 total create+update operations. Quality over quantity. Skip if nothing new.
- Match existing nodes by title (case-insensitive) before creating a new one.
- body: 2-5 sentences, factual, no filler. Markdown allowed.
- **Inside body, wrap every reference to another node as [[Exact Title]].** When you mention a node that exists in "Existing Wiki Pages" or that you are creating in this batch, write [[Title]] instead of plain text. Aim for 1-3 wikilinks per body when relevant nodes exist. Bodies that mention concepts but don't link them are low quality.
- tags[0] must be an entity type from the schema (Feature/Decision/Bug/Pattern/Concept).
- edges.relation_type: one of related|precedes|example_of|counter_example|refines
  - related: generic association
  - precedes: A comes before B in time/sequence/dependency
  - example_of: A is a concrete instance of pattern/concept B
  - counter_example: A contradicts or is rejected in favor of B
  - refines: A is a more specific or improved version of B
- **Edges are the value of a wiki — generate them aggressively.** For each new or updated node, link it to at least one existing or newly-created node when topically related. If multiple relations apply (A is both an example_of and precedes B), pick the most specific one. from_title/to_title must match existing or newly created nodes exactly. Do not invent titles.
- A node with zero inbound and outbound connections (no edges, no wikilinks pointing to or from it) is a code smell — fix it before output.
- If nothing worth extracting, return {"create": [], "update": [], "edges": []}`;

const LINT_PROMPT_HEADER = `You are auditing a project knowledge wiki for quality issues.

## Wiki Pages
{NODES}

---

Output ONLY a JSON array (no prose, no code fences):
[{"type": "contradiction|orphan|duplicate|stale", "node_titles": ["title1", "title2"], "message": "short description"}]

Issue types:
- contradiction: two nodes make conflicting claims
- orphan: node has no connections and seems isolated/useless
- duplicate: two nodes cover the same topic and should be merged
- stale: node references something that seems outdated or removed

Rules:
- Maximum 10 issues. Only flag real problems.
- Return [] if the wiki looks healthy.`;

export async function ingestSource(
  projectId: string,
  sourceText: string,
  sourceType: string | null,
  sourceId: string | null,
  titleHint?: string | null,
  locale?: string | null,
): Promise<IngestResult> {
  const project = queries.getProjectById(projectId);
  if (!project) throw new Error('Project not found');
  const cliTool = resolveCliTool(project.cli_tool);

  // Step 1: persist raw snapshot (immutable). Failure is non-fatal.
  let rawPath: string | null = null;
  if (sourceType && VALID_SOURCE_TYPES.has(sourceType)) {
    const hint = (titleHint && titleHint.trim()) || sourceText.split('\n').find(l => l.trim())?.trim().slice(0, 60) || sourceType;
    rawPath = writeRawSnapshot(project, sourceType, sourceId, sourceText, hint);
  }

  const schema = getOrCreateSchemaNode(projectId);
  const nodes = queries.getMemoryNodesByProjectId(projectId);
  const nodeSummary = buildNodeSummary(nodes);

  const langRule = locale === 'en'
    ? '- Write all titles, body text, tags, and edge labels in English.'
    : '- Write all titles, body text, tags, and edge labels in Korean (한국어).';

  const prompt = INGEST_PROMPT_HEADER
    .replace('Rules:\n', `Rules:\n${langRule}\n`)
    .replace('{SCHEMA}', schema)
    .replace('{NODES}', nodeSummary)
    .replace('{SOURCE}', sourceText.slice(0, 8000));

  const raw = await runHeadless(cliTool, prompt);
  const { op, parseFailed } = safeParseIngestOp(raw);

  const skipped: IngestSkippedBreakdown = {
    parseFailed,
    proposedCreate: op.create.length,
    proposedUpdate: op.update.length,
    proposedEdges: op.edges.length,
    duplicateTitle: 0,
    uniqueConflict: 0,
    emptyTitle: 0,
    invalidUpdateId: 0,
    invalidEdgeRef: 0,
    selfEdge: 0,
    edgeUniqueConflict: 0,
  };

  const titleToId = new Map<string, string>(
    nodes.map(n => [n.title.toLowerCase(), n.id])
  );
  const createdIds: string[] = [];
  let edgesAdded = 0;

  const VALID_RELATIONS = new Set(['related', 'precedes', 'example_of', 'counter_example', 'refines']);

  for (const c of op.create.slice(0, 10)) {
    if (!c.title?.trim()) { skipped.emptyTitle++; continue; }
    const title = String(c.title).trim().slice(0, 120);
    if (titleToId.has(title.toLowerCase())) { skipped.duplicateTitle++; continue; }
    try {
      const tags = Array.isArray(c.tags) ? JSON.stringify(c.tags.map(String).filter(Boolean)) : null;
      const node = queries.createMemoryNode(
        projectId,
        title,
        typeof c.body === 'string' ? c.body : '',
        tags,
        0,
        sourceType,
        sourceId,
        rawPath,
      );
      titleToId.set(title.toLowerCase(), node.id);
      createdIds.push(node.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) skipped.uniqueConflict++;
      else {
        skipped.uniqueConflict++;
        console.warn('[memory-ingest] createMemoryNode failed:', msg);
      }
    }
  }

  let updatedCount = 0;
  for (const u of op.update.slice(0, 10)) {
    if (!u.id) { skipped.invalidUpdateId++; continue; }
    const existing = nodes.find(n => n.id === u.id);
    if (!existing) { skipped.invalidUpdateId++; continue; }
    const upd: Parameters<typeof queries.updateMemoryNode>[1] = {};
    if (typeof u.body === 'string') upd.body = u.body;
    if (Array.isArray(u.tags)) upd.tags = JSON.stringify(u.tags.map(String).filter(Boolean));
    if (Object.keys(upd).length > 0) {
      queries.updateMemoryNode(u.id, upd);
      updatedCount++;
    }
  }

  for (const e of op.edges.slice(0, 20)) {
    const fromId = titleToId.get(String(e.from_title || '').toLowerCase());
    const toId = titleToId.get(String(e.to_title || '').toLowerCase());
    if (!fromId || !toId) { skipped.invalidEdgeRef++; continue; }
    if (fromId === toId) { skipped.selfEdge++; continue; }
    const rt = VALID_RELATIONS.has(e.relation_type ?? '') ? e.relation_type! : 'related';
    try {
      queries.createMemoryEdge(projectId, fromId, toId, rt as queries.MemoryRelationType, e.label ?? null);
      edgesAdded++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) skipped.edgeUniqueConflict++;
      else {
        skipped.edgeUniqueConflict++;
        console.warn('[memory-ingest] createMemoryEdge failed:', msg);
      }
    }
  }

  if (parseFailed || (createdIds.length === 0 && updatedCount === 0 && edgesAdded === 0)) {
    console.warn(
      `[memory-ingest] no-op result project=${projectId} cli=${cliTool} parseFailed=${parseFailed} ` +
      `proposed(c/u/e)=${op.create.length}/${op.update.length}/${op.edges.length} ` +
      `skip=dup:${skipped.duplicateTitle}/uniq:${skipped.uniqueConflict}/badId:${skipped.invalidUpdateId}/` +
      `badEdge:${skipped.invalidEdgeRef}/empty:${skipped.emptyTitle}`
    );
    if (parseFailed) {
      console.warn('[memory-ingest] raw response head:', raw.slice(0, 500));
    }
  }

  return {
    created: createdIds.length,
    updated: updatedCount,
    edgesAdded,
    nodeIds: createdIds,
    skipped,
    rawResponseSnippet: parseFailed ? raw.slice(0, 500) : undefined,
  };
}

export async function lintWiki(projectId: string): Promise<LintIssue[]> {
  const project = queries.getProjectById(projectId);
  if (!project) throw new Error('Project not found');
  const cliTool = resolveCliTool(project.cli_tool);

  const nodes = queries.getMemoryNodesByProjectId(projectId);
  const visible = nodes.filter(n => {
    try {
      const tags = JSON.parse(n.tags ?? '[]');
      return !Array.isArray(tags) || !tags.includes(WIKI_SCHEMA_TAG);
    } catch { return true; }
  });
  if (visible.length === 0) return [];

  const edges = queries.getMemoryEdgesByProjectId(projectId);
  const edgeSet = new Set(edges.flatMap(e => [e.from_node_id, e.to_node_id]));

  const nodeText = visible.map(n => {
    const body = (n.body || '').slice(0, 400);
    const hasEdge = edgeSet.has(n.id) ? '' : ' [no-edges]';
    return `### ${n.title}${hasEdge}\n${body}`;
  }).join('\n\n');

  const prompt = LINT_PROMPT_HEADER.replace('{NODES}', nodeText.slice(0, 12000));

  const raw = await runHeadless(cliTool, prompt);
  return safeParseLintIssues(raw);
}

export function buildSourceTextFromTodo(todoId: string): string | null {
  const todo = queries.getTodoById(todoId);
  if (!todo) return null;
  const logs = queries.getTaskLogsByTodoId(todoId);
  if (logs.length === 0) return null;

  const assistantLogs = logs
    .filter(l => l.log_type === 'assistant' && l.message.trim())
    .sort((a, b) => (a.round_number ?? 1) - (b.round_number ?? 1));
  if (assistantLogs.length === 0) return null;

  const lines: string[] = [];
  lines.push(`# Task: ${todo.title}`);
  if (todo.description) {
    lines.push('');
    lines.push('## Description');
    lines.push(todo.description.trim());
  }
  lines.push('');

  // Group by round
  const byRound = new Map<number, string[]>();
  for (const l of assistantLogs) {
    const r = l.round_number ?? 1;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r)!.push(l.message.trim());
  }
  for (const [round, msgs] of [...byRound.entries()].sort(([a], [b]) => a - b)) {
    lines.push(`## Round ${round}`);
    lines.push(msgs.join('\n\n'));
    lines.push('');
  }
  return lines.join('\n');
}

export function buildSourceTextFromDiscussion(discussionId: string): string | null {
  const discussion = queries.getDiscussionById(discussionId);
  if (!discussion) return null;
  const messages = queries.getDiscussionMessages(discussionId);
  if (messages.length === 0) return null;

  const completed = messages.filter(m => m.status === 'completed' && m.content && m.content.trim());
  if (completed.length === 0) return null;

  const lines: string[] = [];
  lines.push(`# Discussion: ${discussion.title}`);
  if (discussion.description) {
    lines.push('');
    lines.push('## Description');
    lines.push(discussion.description.trim());
  }
  lines.push('');

  let lastRound = -1;
  for (const m of completed) {
    if (m.round_number !== lastRound) {
      lines.push(`## Round ${m.round_number}`);
      lastRound = m.round_number;
    }
    lines.push(`### ${m.agent_name} (${m.role})`);
    lines.push((m.content ?? '').trim());
    lines.push('');
  }
  return lines.join('\n');
}
