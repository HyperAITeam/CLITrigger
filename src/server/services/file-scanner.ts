import fs from 'fs';
import path from 'path';
import ignore, { type Ignore } from 'ignore';
import { parseWikilinks } from './memory-wikilinks.js';

export type VaultFileKind = 'md' | 'html';

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

const DEFAULT_EXCLUDES = [
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

function walkDir(dir: string, root: string, excludes: string[], ig: Ignore, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(root, fullPath).replace(/\\/g, '/');

    if (shouldExclude(rel, excludes)) continue;

    const matchPath = entry.isDirectory() ? rel + '/' : rel;
    if (ig.ignores(matchPath)) continue;

    if (entry.isDirectory()) {
      walkDir(fullPath, root, excludes, ig, results);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.html') || entry.name.endsWith('.htm'))) {
      results.push(rel);
    }
  }
}

export function scanVault(projectRoot: string, excludePatterns?: string[]): VaultFile[] {
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return [];

  const excludes = excludePatterns ?? DEFAULT_EXCLUDES;
  const ig = loadVaultIgnore(resolved);
  const relativePaths: string[] = [];
  walkDir(resolved, resolved, excludes, ig, relativePaths);

  const files: VaultFile[] = [];
  for (const rel of relativePaths) {
    const abs = path.join(resolved, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch { continue; }

    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch { continue; }

    const lower = rel.toLowerCase();
    const kind: VaultFileKind = lower.endsWith('.md') ? 'md' : 'html';
    const ext = kind === 'md' ? '.md' : (lower.endsWith('.html') ? '.html' : '.htm');
    const stem = path.basename(rel, ext);

    let title = stem;
    const tags: string[] = [];
    let wikilinks: string[] = [];
    let bodyFlat = '';

    if (kind === 'md') {
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
      bodyFlat = body.replace(/\s+/g, ' ').trim();
      title = (frontmatter?.title as string) || stem;
    } else {
      const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/i);
      if (titleMatch && titleMatch[1].trim()) title = titleMatch[1].trim();
      const stripped = content
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      bodyFlat = stripped.replace(/\s+/g, ' ').trim();
    }

    const bodyPreview = bodyFlat.length > BODY_PREVIEW_LEN
      ? bodyFlat.slice(0, BODY_PREVIEW_LEN) + '…'
      : bodyFlat;

    files.push({
      relativePath: rel,
      stem,
      title,
      tags: [...new Set(tags)],
      wikilinks,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      bodyPreview,
      kind,
    });
  }

  return files;
}

export function buildVaultGraph(projectRoot: string, excludePatterns?: string[]): VaultGraph {
  const files = scanVault(projectRoot, excludePatterns);

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
    return true;
  } catch {
    return false;
  }
}

export function searchVault(projectRoot: string, query: string, excludePatterns?: string[]): VaultFile[] {
  if (!query.trim()) return [];
  const files = scanVault(projectRoot, excludePatterns);
  const q = query.toLowerCase();
  return files.filter(f =>
    f.stem.toLowerCase().includes(q) ||
    f.title.toLowerCase().includes(q) ||
    f.tags.some(t => t.toLowerCase().includes(q)) ||
    f.bodyPreview.toLowerCase().includes(q)
  );
}
