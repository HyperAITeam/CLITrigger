import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as queries from '../db/queries.js';
import type { CliTool } from './cli-adapters.js';
import { broadcaster } from '../websocket/broadcaster.js';
import { debugLogger, type DebugSession } from './debug-logger.js';
import { dispatchWikiExport } from './wiki-exporter.js';

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
    // Only ignore the raw snapshot subdirectory — leave wiki/ trackable in git
    // so users can opt into committing the auto-exported markdown wiki.
    ensureGitignore(project.path, `${RAW_DIR_NAME}/${RAW_SUBDIR}/`);

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

const WIKI_INDEX_TAG = '__wiki_index__';

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

/**
 * Open a debug session for a memory-ingest or lint run when the project has debug_logging enabled.
 * Reuses the existing `.debug-logs/` directory and rotation policy.
 * The synthetic todoId encodes intent (`mem-{kind}-{sourceType}-{sourceId|ts}`) so logs sort/filter
 * cleanly alongside real todo logs.
 */
function startDebugSession(
  project: queries.Project,
  cliTool: CliTool,
  sourceType: string | null,
  sourceId: string | null,
  kind: string,
): DebugSession | undefined {
  if (!project.debug_logging || !project.path) return undefined;
  const { command, args } = buildInvocation(cliTool);
  const idPart = sourceId ? sourceId.slice(0, 8) : Date.now().toString(36);
  const stypePart = sourceType ?? 'manual';
  const todoId = `mem-${kind}-${stypePart}-${idPart}`;
  try {
    return debugLogger.startSession({
      todoId,
      projectPath: project.path,
      cliTool,
      command,
      args,
      workDir: process.env.HOME || process.env.USERPROFILE || '.',
    });
  } catch (err) {
    console.warn('[memory-ingest] failed to open debug session:', err);
    return undefined;
  }
}

export function runHeadless(
  cliTool: CliTool,
  prompt: string,
  timeoutMs = 180_000,
  debugSession?: DebugSession,
): Promise<string> {
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

    if (debugSession) {
      // tee returns a passthrough we don't need; the side-effect is appending to the debug log file.
      debugSession.teeStdout(proc.stdout);
      debugSession.teeStderr(proc.stderr);
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch { /* ignore */ }
      try { debugSession?.finalize(-1); } catch { /* ignore */ }
      reject(new Error('Memory ingest timed out'));
    }, timeoutMs);

    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { debugSession?.finalize(-1); } catch { /* ignore */ }
      reject(err);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { debugSession?.finalize(code ?? 0); } catch { /* ignore */ }
      if (code === 0) resolve(stdout);
      else reject(new Error(`CLI exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
    });

    try {
      proc.stdin.write(prompt + '\n');
      proc.stdin.end();
      try { debugSession?.writeStdin(prompt); } catch { /* ignore */ }
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { debugSession?.finalize(-1); } catch { /* ignore */ }
      try { proc.kill(); } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function resolveCliTool(value: unknown): CliTool {
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

const NODE_SUMMARY_FULL_CHAR_BUDGET = 6000;
const NODE_SUMMARY_TITLES_FALLBACK_BUDGET = 1500;
const NODE_SUMMARY_PINNED_BODY_PREVIEW = 300;

function formatFullNodeLine(n: queries.MemoryNode): string {
  try {
    const tags: string[] = JSON.parse(n.tags ?? '[]');
    const tagStr = tags.filter(t => t !== WIKI_SCHEMA_TAG && t !== WIKI_INDEX_TAG).join(', ');
    const pinnedStr = n.pinned ? ' [pinned]' : '';
    const bodyPreview = n.pinned ? `\n  ${(n.body || '').slice(0, NODE_SUMMARY_PINNED_BODY_PREVIEW)}` : '';
    return `- id="${n.id}" title="${n.title}"${tagStr ? ` tags=[${tagStr}]` : ''}${pinnedStr}${bodyPreview}`;
  } catch {
    return `- id="${n.id}" title="${n.title}"`;
  }
}

function buildNodeSummary(nodes: queries.MemoryNode[]): string {
  const visible = nodes.filter(n => {
    try {
      const tags = JSON.parse(n.tags ?? '[]');
      if (!Array.isArray(tags)) return true;
      return !tags.includes(WIKI_SCHEMA_TAG) && !tags.includes(WIKI_INDEX_TAG);
    } catch { return true; }
  });
  if (visible.length === 0) return '(no existing pages)';

  // Pinned first (user-curated importance), then most-recently-updated.
  const sorted = [...visible].sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  });

  const lines: string[] = [];
  let used = 0;
  let inlined = 0;

  for (const n of sorted) {
    const line = formatFullNodeLine(n);
    // Always include pinned nodes regardless of budget; gate non-pinned by char budget.
    if (!n.pinned && used + line.length > NODE_SUMMARY_FULL_CHAR_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
    inlined++;
  }

  const remaining = sorted.slice(inlined);
  if (remaining.length > 0) {
    // Titles-only tail so the LLM can still match by exact title (avoid duplicate creates),
    // even though older nodes' IDs aren't shown so they cannot be updated in this batch.
    const titles: string[] = [];
    let titleBudget = NODE_SUMMARY_TITLES_FALLBACK_BUDGET;
    for (const n of remaining) {
      const piece = `"${n.title}"`;
      if (titleBudget - piece.length - 2 < 0) break;
      titles.push(piece);
      titleBudget -= piece.length + 2;
    }
    const hiddenCount = remaining.length - titles.length;
    if (titles.length > 0) {
      const tail = hiddenCount > 0 ? ` … and ${hiddenCount} more` : '';
      lines.push('');
      lines.push(`(other existing titles — match exactly to avoid duplicates; IDs not shown so these are not updatable in this batch: ${titles.join(', ')}${tail})`);
    } else {
      lines.push('');
      lines.push(`(${remaining.length} older entries omitted to fit context)`);
    }
  }

  return lines.join('\n');
}

const INGEST_PROMPT_HEADER = `You are maintaining a project knowledge wiki using the LLM Wiki pattern.{CHUNK_PREAMBLE}

## Wiki Schema
{SCHEMA}

## Existing Wiki Pages
{NODES}

## New Source Material{CHUNK_NOTE}
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

const CHUNK_CHARS = 7000;
const CHUNK_THRESHOLD = 8000;
const MAX_CHUNKS = 4;
const VALID_RELATIONS = new Set(['related', 'precedes', 'example_of', 'counter_example', 'refines']);

/**
 * Split a long source into chunks at paragraph boundaries. Hard-splits any single paragraph
 * that exceeds maxChars. Caps total chunks at maxChunks (later content is dropped).
 * Returns a single-element array when text fits without splitting.
 */
function chunkSourceText(text: string, maxChars: number, maxChunks: number): string[] {
  if (text.length <= CHUNK_THRESHOLD) return [text];
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = '';
  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;
    if (chunks.length >= maxChunks) break;
    if (cur.length + p.length + 2 <= maxChars) {
      cur = cur ? `${cur}\n\n${p}` : p;
      continue;
    }
    if (cur) {
      chunks.push(cur);
      cur = '';
      if (chunks.length >= maxChunks) break;
    }
    if (p.length > maxChars) {
      for (let i = 0; i < p.length && chunks.length < maxChunks; i += maxChars) {
        chunks.push(p.slice(i, i + maxChars));
      }
    } else {
      cur = p;
    }
  }
  if (cur && chunks.length < maxChunks) chunks.push(cur);
  return chunks.slice(0, maxChunks);
}

interface ChunkApplyContext {
  projectId: string;
  sourceType: string | null;
  sourceId: string | null;
  rawPath: string | null;
  titleToId: Map<string, string>;
  createdIds: string[];
  updatedIds: Set<string>;
  edgesAdded: number;
  skipped: IngestSkippedBreakdown;
  lastRaw: string;
}

function applyIngestOp(ctx: ChunkApplyContext, op: IngestOp, existingNodes: queries.MemoryNode[]): void {
  ctx.skipped.proposedCreate += op.create.length;
  ctx.skipped.proposedUpdate += op.update.length;
  ctx.skipped.proposedEdges += op.edges.length;

  for (const c of op.create.slice(0, 10)) {
    if (!c.title?.trim()) { ctx.skipped.emptyTitle++; continue; }
    const title = String(c.title).trim().slice(0, 120);
    if (ctx.titleToId.has(title.toLowerCase())) { ctx.skipped.duplicateTitle++; continue; }
    try {
      const tags = Array.isArray(c.tags) ? JSON.stringify(c.tags.map(String).filter(Boolean)) : null;
      const node = queries.createMemoryNode(
        ctx.projectId,
        title,
        typeof c.body === 'string' ? c.body : '',
        tags,
        0,
        ctx.sourceType,
        ctx.sourceId,
        ctx.rawPath,
      );
      ctx.titleToId.set(title.toLowerCase(), node.id);
      ctx.createdIds.push(node.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) ctx.skipped.uniqueConflict++;
      else {
        ctx.skipped.uniqueConflict++;
        console.warn('[memory-ingest] createMemoryNode failed:', msg);
      }
    }
  }

  for (const u of op.update.slice(0, 10)) {
    if (!u.id) { ctx.skipped.invalidUpdateId++; continue; }
    const existing = existingNodes.find(n => n.id === u.id);
    if (!existing) { ctx.skipped.invalidUpdateId++; continue; }
    const upd: Parameters<typeof queries.updateMemoryNode>[1] = {};
    if (typeof u.body === 'string') upd.body = u.body;
    if (Array.isArray(u.tags)) upd.tags = JSON.stringify(u.tags.map(String).filter(Boolean));
    if (Object.keys(upd).length > 0) {
      queries.updateMemoryNode(u.id, upd);
      ctx.updatedIds.add(u.id);
    }
  }

  for (const e of op.edges.slice(0, 20)) {
    const fromId = ctx.titleToId.get(String(e.from_title || '').toLowerCase());
    const toId = ctx.titleToId.get(String(e.to_title || '').toLowerCase());
    if (!fromId || !toId) { ctx.skipped.invalidEdgeRef++; continue; }
    if (fromId === toId) { ctx.skipped.selfEdge++; continue; }
    const rt = VALID_RELATIONS.has(e.relation_type ?? '') ? e.relation_type! : 'related';
    try {
      queries.createMemoryEdge(ctx.projectId, fromId, toId, rt as queries.MemoryRelationType, e.label ?? null);
      ctx.edgesAdded++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) ctx.skipped.edgeUniqueConflict++;
      else {
        ctx.skipped.edgeUniqueConflict++;
        console.warn('[memory-ingest] createMemoryEdge failed:', msg);
      }
    }
  }
}

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
  const langRule = locale === 'en'
    ? '- Write all titles, body text, tags, and edge labels in English.'
    : '- Write all titles, body text, tags, and edge labels in Korean (한국어).';

  const chunks = chunkSourceText(sourceText, CHUNK_CHARS, MAX_CHUNKS);
  const total = chunks.length;

  const ctx: ChunkApplyContext = {
    projectId,
    sourceType,
    sourceId,
    rawPath,
    titleToId: new Map<string, string>(),
    createdIds: [],
    updatedIds: new Set<string>(),
    edgesAdded: 0,
    skipped: {
      parseFailed: false,
      proposedCreate: 0, proposedUpdate: 0, proposedEdges: 0,
      duplicateTitle: 0, uniqueConflict: 0, emptyTitle: 0,
      invalidUpdateId: 0, invalidEdgeRef: 0, selfEdge: 0, edgeUniqueConflict: 0,
    },
    lastRaw: '',
  };

  for (let i = 0; i < total; i++) {
    // Re-fetch nodes between chunks so dedup sees nodes added by earlier chunks.
    const nodes = queries.getMemoryNodesByProjectId(projectId);
    ctx.titleToId = new Map(nodes.map(n => [n.title.toLowerCase(), n.id]));
    const nodeSummary = buildNodeSummary(nodes);

    const chunkPreamble = total > 1
      ? `\n\nThis source has been split into ${total} parts due to length. You are processing part ${i + 1}. Earlier parts may have added new pages — see "Existing Wiki Pages" for the current state. Avoid creating duplicates of pages already added in earlier parts.`
      : '';
    const chunkNote = total > 1 ? ` (part ${i + 1} of ${total})` : '';

    const prompt = INGEST_PROMPT_HEADER
      .replace('Rules:\n', `Rules:\n${langRule}\n`)
      .replace('{CHUNK_PREAMBLE}', chunkPreamble)
      .replace('{CHUNK_NOTE}', chunkNote)
      .replace('{SCHEMA}', schema)
      .replace('{NODES}', nodeSummary)
      .replace('{SOURCE}', chunks[i]);

    const debugSession = startDebugSession(
      project,
      cliTool,
      sourceType,
      sourceId,
      total > 1 ? `ingest-${i + 1}of${total}` : 'ingest',
    );
    const raw = await runHeadless(cliTool, prompt, 180_000, debugSession);
    ctx.lastRaw = raw;
    const { op, parseFailed } = safeParseIngestOp(raw);
    if (parseFailed) ctx.skipped.parseFailed = true;
    applyIngestOp(ctx, op, nodes);
  }

  const created = ctx.createdIds.length;
  const updated = ctx.updatedIds.size;
  const edgesAdded = ctx.edgesAdded;

  if (ctx.skipped.parseFailed || (created === 0 && updated === 0 && edgesAdded === 0)) {
    console.warn(
      `[memory-ingest] no-op result project=${projectId} cli=${cliTool} chunks=${total} ` +
      `parseFailed=${ctx.skipped.parseFailed} ` +
      `proposed(c/u/e)=${ctx.skipped.proposedCreate}/${ctx.skipped.proposedUpdate}/${ctx.skipped.proposedEdges} ` +
      `skip=dup:${ctx.skipped.duplicateTitle}/uniq:${ctx.skipped.uniqueConflict}/badId:${ctx.skipped.invalidUpdateId}/` +
      `badEdge:${ctx.skipped.invalidEdgeRef}/empty:${ctx.skipped.emptyTitle}`
    );
    if (ctx.skipped.parseFailed) {
      console.warn('[memory-ingest] last raw response head:', ctx.lastRaw.slice(0, 500));
    }
  }

  // Mirror DB → `.clitrigger/wiki/` markdown files (best-effort, fire-and-forget).
  dispatchWikiExport(projectId);

  // Project-scoped activity log entry — feeds the Wiki Activity tab.
  try {
    const applied = created + updated + edgesAdded;
    let severity: queries.MemoryLogSeverity = 'info';
    let message: string;
    if (ctx.skipped.parseFailed) {
      severity = 'error';
      message = `Ingest failed to parse model output (${total} chunk${total > 1 ? 's' : ''})`;
    } else if (applied === 0) {
      severity = 'warning';
      message = `Ingest produced no changes — nothing new in source`;
    } else {
      message = `Ingested ${created} new, ${updated} updated, ${edgesAdded} edge${edgesAdded === 1 ? '' : 's'}`;
    }
    queries.createMemoryLog(projectId, 'ingest', message, {
      severity,
      sourceType: sourceType ?? 'manual',
      sourceId,
      sourceTitle: titleHint ?? null,
      metadata: {
        cliTool,
        chunks: total,
        created,
        updated,
        edgesAdded,
        skipped: ctx.skipped,
      },
    });
  } catch (err) {
    console.warn('[memory-ingest] failed to write memory_logs entry:', err);
  }

  return {
    created,
    updated,
    edgesAdded,
    nodeIds: ctx.createdIds,
    skipped: ctx.skipped,
    rawResponseSnippet: ctx.skipped.parseFailed ? ctx.lastRaw.slice(0, 500) : undefined,
  };
}

const LINT_CHUNK_CHARS = 10000;
const LINT_MAX_CHUNKS = 5;

function chunkLintEntries(entries: string[], maxChars: number, maxChunks: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const entry of entries) {
    if (chunks.length >= maxChunks) break;
    const sep = cur ? '\n\n' : '';
    if (cur && cur.length + sep.length + entry.length > maxChars) {
      chunks.push(cur);
      if (chunks.length >= maxChunks) { cur = ''; break; }
      cur = entry.length > maxChars ? entry.slice(0, maxChars) : entry;
    } else {
      cur = `${cur}${sep}${entry.length > maxChars ? entry.slice(0, maxChars) : entry}`;
    }
  }
  if (cur && chunks.length < maxChunks) chunks.push(cur);
  return chunks;
}

function dedupeLintIssues(issues: LintIssue[]): LintIssue[] {
  const seen = new Set<string>();
  const out: LintIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.type}::${[...issue.node_titles].map(s => s.toLowerCase()).sort().join('|')}::${issue.message.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export async function lintWiki(projectId: string): Promise<LintIssue[]> {
  const project = queries.getProjectById(projectId);
  if (!project) throw new Error('Project not found');
  const cliTool = resolveCliTool(project.cli_tool);

  const nodes = queries.getMemoryNodesByProjectId(projectId);
  const visible = nodes.filter(n => {
    try {
      const tags = JSON.parse(n.tags ?? '[]');
      if (!Array.isArray(tags)) return true;
      return !tags.includes(WIKI_SCHEMA_TAG) && !tags.includes(WIKI_INDEX_TAG);
    } catch { return true; }
  });
  if (visible.length === 0) return [];

  const edges = queries.getMemoryEdgesByProjectId(projectId);
  const edgeSet = new Set(edges.flatMap(e => [e.from_node_id, e.to_node_id]));

  const entries = visible.map(n => {
    const body = (n.body || '').slice(0, 400);
    const hasEdge = edgeSet.has(n.id) ? '' : ' [no-edges]';
    return `### ${n.title}${hasEdge}\n${body}`;
  });

  // Larger wikis used to be silently truncated to 12KB — the tail nodes never
  // got linted. Split into chunks so every node is seen by at least one pass.
  // Cross-chunk duplicates aren't detected (each chunk only sees its own
  // entries), but orphan/stale/contradiction within a chunk still work.
  const chunks = chunkLintEntries(entries, LINT_CHUNK_CHARS, LINT_MAX_CHUNKS);
  const truncated = entries.length > 0 && chunks.join('\n\n').length < entries.join('\n\n').length;

  const collected: LintIssue[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt = LINT_PROMPT_HEADER.replace('{NODES}', chunks[i]);
    const kind = chunks.length > 1 ? `lint-${i + 1}of${chunks.length}` : 'lint';
    const debugSession = startDebugSession(project, cliTool, null, null, kind);
    const raw = await runHeadless(cliTool, prompt, 180_000, debugSession);
    collected.push(...safeParseLintIssues(raw));
  }

  const issues = dedupeLintIssues(collected);

  try {
    const counts: Record<string, number> = {};
    for (const issue of issues) {
      counts[issue.type] = (counts[issue.type] ?? 0) + 1;
    }
    const summary = issues.length === 0
      ? `Wiki looks healthy — no issues found${chunks.length > 1 ? ` (${chunks.length} chunks)` : ''}`
      : `Lint found ${issues.length} issue${issues.length === 1 ? '' : 's'}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}${chunks.length > 1 ? ` (across ${chunks.length} chunks)` : ''}`;
    queries.createMemoryLog(projectId, 'lint', summary, {
      severity: issues.length === 0 ? 'info' : 'warning',
      metadata: {
        cliTool,
        total: issues.length,
        counts,
        nodeCount: visible.length,
        chunks: chunks.length,
        truncated,
      },
    });
  } catch (err) {
    console.warn('[memory-lint] failed to write memory_logs entry:', err);
  }

  return issues;
}

/**
 * Run an auto-ingest and broadcast the result over WebSocket so the client can show a toast.
 * Errors are swallowed (auto-ingest is best-effort) but reported as a failure event.
 */
export function runAutoIngestAndBroadcast(
  projectId: string,
  sourceType: 'todo' | 'discussion',
  sourceId: string,
  sourceTitle: string | null,
  sourceText: string,
): void {
  ingestSource(projectId, sourceText, sourceType, sourceId, sourceTitle).then((res) => {
    broadcaster.broadcast({
      type: 'memory:ingest-finished',
      projectId,
      sourceType,
      sourceId,
      sourceTitle,
      created: res.created,
      updated: res.updated,
      edgesAdded: res.edgesAdded,
      skipped: res.skipped,
    });
  }).catch((err) => {
    console.error(`[memory-ingest] auto-ingest failed (${sourceType}):`, err);
    broadcaster.broadcast({
      type: 'memory:ingest-finished',
      projectId,
      sourceType,
      sourceId,
      sourceTitle,
      created: 0,
      updated: 0,
      edgesAdded: 0,
      skipped: {
        parseFailed: false,
        proposedCreate: 0, proposedUpdate: 0, proposedEdges: 0,
        duplicateTitle: 0, uniqueConflict: 0, emptyTitle: 0,
        invalidUpdateId: 0, invalidEdgeRef: 0, selfEdge: 0, edgeUniqueConflict: 0,
      },
      error: err instanceof Error ? err.message : String(err),
    });
  });
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
