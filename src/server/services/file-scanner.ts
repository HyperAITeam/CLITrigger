import fs from 'fs';
import path from 'path';
import ignore, { type Ignore } from 'ignore';
import { parseWikilinks } from './memory-wikilinks.js';

export type VaultFileKind = 'md' | 'html' | 'pdf';

export interface VaultFile {
  relativePath: string;
  stem: string;
  title: string;
  tags: string[];
  wikilinks: string[];
  size: number;
  mtime: string;
  bodyPreview: string;
  kind: VaultFileKind;
}

export interface VaultEdge {
  from: string;
  to: string;
}

export interface VaultGraph {
  files: VaultFile[];
  edges: VaultEdge[];
}

export const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.worktrees',
  'out',
  '.next',
  '.nuxt',
  'vendor',
  '.venv',
  '__pycache__',
  '.tox',
  'coverage',
];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const BODY_PREVIEW_LEN = 200;

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: content };

  const raw = match[1];
  const body = content.slice(match[0].length).trimStart();
  const fm: Record<string, unknown> = {};

  for (const line of raw.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      try {
        value = JSON.parse(value);
      } catch {
        const inner = (value as string).slice(1, -1);
        value = inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      }
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body };
}

/** Strip fenced + inline code so `#` inside code isn't read as a tag. */
function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

// 태그: 공백/줄시작 뒤 `#`, 그 뒤 태그문자. 최소 1개의 "글자"(\p{L})를 강제해
// 순수 숫자(#123)·기호를 배제. /로 중첩 태그(parent/child) 허용. u 플래그로 한글 지원.
const INLINE_TAG_RE = /(?:^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;

export function parseInlineTags(body: string): string[] {
  if (!body) return [];
  const text = stripCode(body);
  const out = new Set<string>();
  INLINE_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_TAG_RE.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

function shouldExclude(relativePath: string, excludes: string[]): boolean {
  const parts = relativePath.split(/[\\/]/);
  return parts.some(p => excludes.includes(p));
}

export function loadVaultIgnore(projectRoot: string): Ignore {
  const ig = ignore();
  try {
    const txt = fs.readFileSync(path.join(projectRoot, '.vaultignore'), 'utf-8');
    ig.add(txt);
  } catch { /* absent or unreadable — empty ignore */ }
  return ig;
}

// Rewrite .vaultignore content so `relPath` is no longer ignored.
//
// Removing the exact anchored pattern line (the inverse of a prior "hide")
// is tried first, but it's not enough when a broad pattern like `*` covers
// the path — and gitignore semantics can't re-include a file while any
// ancestor directory is still excluded. So when the path remains ignored we
// append a negation chain: `!/a/`, `!/a/b/`, … for every ancestor, then the
// target itself (`!/a/b/file.md`, or `!/dir/` + `!/dir/**` for directories).
// The result is verified with the same `ignore` package the scanner uses.
export function unhideInVaultIgnore(content: string, relPath: string, isDir: boolean): string {
  const rel = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const exact = '/' + rel + (isDir ? '/' : '');
  let lines = content.split(/\r?\n/).filter((l) => l.trim() !== exact);

  const matchPath = isDir ? rel + '/' : rel;
  const isIgnored = () => {
    const ig = ignore();
    ig.add(lines.join('\n'));
    return ig.ignores(matchPath);
  };

  if (isIgnored()) {
    const additions: string[] = [];
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      additions.push('!/' + parts.slice(0, i).join('/') + '/');
    }
    if (isDir) {
      additions.push('!/' + rel + '/');
      additions.push('!/' + rel + '/**');
    } else {
      additions.push('!/' + rel);
    }
    const present = new Set(lines.map((l) => l.trim()));
    for (const a of additions) {
      if (!present.has(a)) lines.push(a);
    }
  }

  // Tidy: collapse the blank run a removed line can leave behind.
  let next = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  if (next.trim() === '') return '';
  if (!next.endsWith('\n')) next += '\n';
  return next;
}

// ── Scanning ──
// Async with bounded parallelism: a huge root (e.g. a whole work drive) used
// to run fully synchronously and stall every request and terminal for 15–30s.
// Parsed docs are cached per file (mtime+size), and a root's whole result is
// reused while vault-watcher watches that root and reports no change.

const SCAN_CONCURRENCY = 32;
// .md is read up to this for inline #tags / [[wikilinks]] (real-world: 3 of
// ~6.8k docs exceed it); HTML only yields <title> and a preview.
const MD_READ_CAP = 256 * 1024;
const HTML_READ_CAP = 64 * 1024;
const PREVIEW_SOURCE_CHARS = 4 * 1024;
// Safety nets (mutable for tests): a scan stuck on an offline network folder
// fails instead of pinning the root forever, and a watched result is not
// trusted forever (some network folders never deliver fs.watch events).
export const vaultScanLimits = { timeoutMs: 120_000, maxCacheAgeMs: 5 * 60_000 };

interface CachedDoc { mtimeMs: number; size: number; file: VaultFile }
interface RootState {
  docs: Map<string, CachedDoc>; // rel → parsed doc, pruned to the last scan
  dirs: Set<string>;            // every folder holding a doc in the last scan
  files: VaultFile[] | null;    // last full result
  fresh: boolean;               // result still valid (watched, no change since)
  gen: number;                  // bumped on every change notice
  inflight: Promise<VaultFile[]> | null;
  inflightGen: number;          // gen the in-flight scan started at
  run: number;                  // bumped per scan; a timed-out scan must not commit late
  scannedAt: number;            // when `files` was produced
}
// ponytail: one state per (root, excludes) ever scanned, never evicted — fine for a few dozen projects
const rootStates = new Map<string, RootState>();
const watchedRoots = new Map<string, number>(); // resolved root → watcher refcount

/** Bounded-parallel directory walk; returns root-relative doc paths, sorted. */
function walkDir(root: string, excludes: string[], ig: Ignore): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [root];
  let active = 0;
  return new Promise((resolve) => {
    const visit = (dir: string, entries: fs.Dirent[]) => {
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(root, fullPath).replace(/\\/g, '/');

        if (shouldExclude(rel, excludes)) continue;

        const matchPath = entry.isDirectory() ? rel + '/' : rel;
        if (ig.ignores(matchPath)) continue;

        if (entry.isDirectory()) {
          queue.push(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.html') || entry.name.endsWith('.htm') || entry.name.endsWith('.pdf'))) {
          results.push(rel);
        }
      }
    };
    const pump = () => {
      while (active < SCAN_CONCURRENCY && queue.length > 0) {
        const dir = queue.pop()!;
        active++;
        fs.promises.readdir(dir, { withFileTypes: true })
          .then((entries) => visit(dir, entries))
          .catch(() => { /* unreadable dir — skip */ })
          .finally(() => {
            active--;
            if (active === 0 && queue.length === 0) resolve(results.sort());
            else pump();
          });
      }
    };
    pump();
  });
}

async function mapPool(count: number, limit: number, fn: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < count) await fn(next++); };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
}

async function readHead(abs: string, cap: number): Promise<string> {
  const fh = await fs.promises.open(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(cap); // cap is already min(limit, file size)
    const { bytesRead } = await fh.read(buf, 0, cap, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function parseVaultFile(abs: string, rel: string, stat: fs.Stats): Promise<VaultFile> {
  const lower = rel.toLowerCase();
  const kind: VaultFileKind = lower.endsWith('.md') ? 'md'
    : lower.endsWith('.pdf') ? 'pdf'
    : 'html';
  const ext = kind === 'md' ? '.md'
    : kind === 'pdf' ? '.pdf'
    : (lower.endsWith('.html') ? '.html' : '.htm');
  const stem = path.basename(rel, ext);

  let title = stem;
  const tags: string[] = [];
  let wikilinks: string[] = [];
  let bodyFlat = '';

  if (kind === 'md') {
    const content = await readHead(abs, Math.min(MD_READ_CAP, stat.size));
    const { frontmatter, body } = parseFrontmatter(content);
    if (frontmatter?.tags) {
      const raw = frontmatter.tags;
      if (Array.isArray(raw)) {
        tags.push(...raw.map(String).filter(Boolean));
      } else if (typeof raw === 'string') {
        tags.push(...raw.split(',').map(s => s.trim()).filter(Boolean));
      }
    }
    tags.push(...parseInlineTags(body));
    const refs = parseWikilinks(body);
    wikilinks = [...new Set(refs.map(r => r.title))];
    bodyFlat = body.slice(0, PREVIEW_SOURCE_CHARS).replace(/\s+/g, ' ').trim();
    title = (frontmatter?.title as string) || stem;
  } else if (kind === 'html') {
    const content = await readHead(abs, Math.min(HTML_READ_CAP, stat.size));
    const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1].trim()) title = titleMatch[1].trim();
    const stripped = content
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      // A <script>/<style> still open at the read cap would leak CSS/JS into the preview.
      .replace(/<(script|style)\b[\s\S]*$/i, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    bodyFlat = stripped.replace(/\s+/g, ' ').trim();
  }
  // pdf: binary — graph node only; no text parsing.

  const bodyPreview = bodyFlat.length > BODY_PREVIEW_LEN
    ? bodyFlat.slice(0, BODY_PREVIEW_LEN) + '…'
    : bodyFlat;

  return {
    relativePath: rel,
    stem,
    title,
    tags: [...new Set(tags)],
    wikilinks,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    bodyPreview,
    kind,
  };
}

async function scanRoot(root: string, excludes: string[], state: RootState, run: number): Promise<VaultFile[]> {
  const rels = await walkDir(root, excludes, loadVaultIgnore(root));
  const next = new Map<string, CachedDoc>();
  const out: (VaultFile | null)[] = new Array(rels.length).fill(null);
  await mapPool(rels.length, SCAN_CONCURRENCY, async (i) => {
    const rel = rels[i];
    const abs = path.join(root, rel);
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(abs); } catch { return; }
    const prev = state.docs.get(rel);
    let file = prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size ? prev.file : null;
    if (!file) {
      try { file = await parseVaultFile(abs, rel, stat); } catch { return; }
    }
    next.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, file });
    out[i] = file;
  });
  if (state.run !== run) return []; // superseded after a timeout — result is discarded anyway
  state.docs = next;
  const dirs = new Set<string>();
  for (const rel of next.keys()) {
    for (let i = rel.lastIndexOf('/'); i > 0; i = rel.lastIndexOf('/', i - 1)) dirs.add(rel.slice(0, i));
  }
  state.dirs = dirs;
  return out.filter((f): f is VaultFile => f !== null);
}

// Callers may reassign or mutate fields (e.g. merged tags); never hand out cached objects.
const cloneFiles = (files: VaultFile[]) => files.map(f => ({ ...f, tags: [...f.tags], wikilinks: [...f.wikilinks] }));

export async function scanVault(projectRoot: string, excludePatterns?: string[]): Promise<VaultFile[]> {
  const resolved = path.resolve(projectRoot);
  try {
    if (!(await fs.promises.stat(resolved)).isDirectory()) return [];
  } catch { return []; }

  const excludes = excludePatterns ?? DEFAULT_EXCLUDES;
  const key = resolved + '\0' + excludes.join('\0');
  let state = rootStates.get(key);
  if (!state) {
    state = { docs: new Map(), dirs: new Set(), files: null, fresh: false, gen: 0, inflight: null, inflightGen: 0, run: 0, scannedAt: 0 };
    rootStates.set(key, state);
  }
  if (state.fresh && state.files && Date.now() - state.scannedAt < vaultScanLimits.maxCacheAgeMs) {
    return cloneFiles(state.files);
  }

  // Single-flight: the docs tab fires files/graph/tags at once for one root.
  let inflight = state.inflight;
  if (inflight && state.inflightGen !== state.gen) {
    // That scan started before a change — its result may miss it. Wait it out
    // (one scanRoot per state at a time: it swaps state.docs) and scan again.
    return inflight.catch(() => undefined).then(() => scanVault(projectRoot, excludePatterns));
  }
  if (!inflight) {
    const s = state;
    const gen = s.gen;
    s.inflightGen = gen;
    const run = ++s.run;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`vault scan timed out after ${Math.round(vaultScanLimits.timeoutMs / 1000)}s: ${resolved}`)),
        vaultScanLimits.timeoutMs,
      );
    });
    inflight = s.inflight = Promise.race([scanRoot(resolved, excludes, s, run), timeout])
      .then((files) => {
        s.files = files;
        s.scannedAt = Date.now();
        s.fresh = (watchedRoots.get(resolved) ?? 0) > 0 && s.gen === gen;
        return files;
      })
      .finally(() => {
        clearTimeout(timer);
        if (s.run === run) s.inflight = null;
      });
  }
  return cloneFiles(await inflight);
}

/** Drop the cached result for `root` (all exclude variants). Per-file parses stay, keyed by mtime+size. */
export function invalidateVaultRoot(root: string): void {
  const prefix = path.resolve(root) + '\0';
  for (const [key, s] of rootStates) {
    if (key.startsWith(prefix)) { s.fresh = false; s.gen++; }
  }
}

/**
 * For a changed name the doc filter can't classify (a dotted folder like
 * "v1.2" renamed/moved/deleted reports just that name): did it hold docs in
 * the last scan, or is it a directory now? Only consulted while a result is
 * cached, so build churn costs one stat per event at most.
 */
export function touchesVaultDir(root: string, filename: string): boolean {
  const r = path.resolve(root);
  const rel = filename.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = r + '\0';
  let cached = false;
  for (const [key, s] of rootStates) {
    if (!key.startsWith(prefix) || !s.fresh) continue;
    cached = true;
    if (s.dirs.has(rel)) return true;
  }
  if (!cached) return false;
  try { return fs.statSync(path.join(r, rel)).isDirectory(); } catch { return false; }
}

/** vault-watcher hook: a cached root result is only trusted while the root is watched. */
export function setVaultRootWatched(root: string, watched: boolean): void {
  const r = path.resolve(root);
  const n = (watchedRoots.get(r) ?? 0) + (watched ? 1 : -1);
  if (n > 0) watchedRoots.set(r, n);
  else watchedRoots.delete(r);
  invalidateVaultRoot(r); // anything that changed while unwatched was missed
}

export function buildVaultGraph(files: VaultFile[]): VaultGraph {
  const stemIndex = new Map<string, string[]>();
  for (const f of files) {
    const key = f.stem.toLowerCase();
    const existing = stemIndex.get(key) ?? [];
    existing.push(f.relativePath);
    stemIndex.set(key, existing);
  }

  const titleIndex = new Map<string, string[]>();
  for (const f of files) {
    const key = f.title.toLowerCase();
    const existing = titleIndex.get(key) ?? [];
    existing.push(f.relativePath);
    titleIndex.set(key, existing);
  }

  const edges: VaultEdge[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const fromDir = path.dirname(f.relativePath);
    for (const link of f.wikilinks) {
      const key = link.toLowerCase();
      const candidates = stemIndex.get(key) ?? titleIndex.get(key) ?? [];
      let target: string | undefined;
      if (candidates.length === 1) {
        target = candidates[0];
      } else if (candidates.length > 1) {
        target = candidates.find(c => path.dirname(c) === fromDir) ?? candidates[0];
      }
      if (target && target !== f.relativePath) {
        const edgeKey = `${f.relativePath}→${target}`;
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          edges.push({ from: f.relativePath, to: target });
        }
      }
    }
  }

  return { files, edges };
}

function hasVaultExt(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.html') || lower.endsWith('.htm');
}

export function readVaultFile(projectRoot: string, relativePath: string): string | null {
  const resolved = path.resolve(projectRoot);
  const abs = path.resolve(resolved, relativePath);
  if (!abs.startsWith(resolved + path.sep) && abs !== resolved) return null;
  if (!hasVaultExt(abs)) return null;
  try {
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
}

export function writeVaultFile(projectRoot: string, relativePath: string, content: string): boolean {
  const resolved = path.resolve(projectRoot);
  const abs = path.resolve(resolved, relativePath);
  if (!abs.startsWith(resolved + path.sep)) return false;
  if (!abs.endsWith('.md')) return false;
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    invalidateVaultRoot(resolved);
    return true;
  } catch {
    return false;
  }
}

export function deleteVaultFile(projectRoot: string, relativePath: string): boolean {
  const resolved = path.resolve(projectRoot);
  const abs = path.resolve(resolved, relativePath);
  if (!abs.startsWith(resolved + path.sep)) return false;
  if (!abs.endsWith('.md')) return false;
  try {
    fs.unlinkSync(abs);
    invalidateVaultRoot(resolved);
    return true;
  } catch {
    return false;
  }
}

export function renameVaultFile(projectRoot: string, oldPath: string, newPath: string): boolean {
  const resolved = path.resolve(projectRoot);
  const absOld = path.resolve(resolved, oldPath);
  const absNew = path.resolve(resolved, newPath);
  if (!absOld.startsWith(resolved + path.sep)) return false;
  if (!absNew.startsWith(resolved + path.sep)) return false;
  if (!absOld.endsWith('.md') || !absNew.endsWith('.md')) return false;
  try {
    fs.mkdirSync(path.dirname(absNew), { recursive: true });
    fs.renameSync(absOld, absNew);
    invalidateVaultRoot(resolved);
    return true;
  } catch {
    return false;
  }
}

export function searchVault(files: VaultFile[], query: string): VaultFile[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return files.filter(f =>
    f.stem.toLowerCase().includes(q) ||
    f.title.toLowerCase().includes(q) ||
    f.tags.some(t => t.toLowerCase().includes(q)) ||
    f.bodyPreview.toLowerCase().includes(q)
  );
}
