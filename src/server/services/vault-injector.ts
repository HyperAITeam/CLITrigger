import fs from 'fs';
import type { Project } from '../db/queries.js';
import { resolveVaultPath, scanProjectVault } from './vault-roots.js';
import { parseWikilinks } from './memory-wikilinks.js';

export type VaultInjectMode = 'none' | 'all' | 'selected' | 'auto';

export interface VaultInjectionRequest {
  project: Pick<Project, 'id' | 'path' | 'vault_links'>;
  mode: VaultInjectMode;
  filePaths?: string[];
  excludePatterns?: string[];
}

export interface VaultInjectionResult {
  block: string;
  fileCount: number;
}

const DEFAULT_PER_FILE_CHAR_CAP = 50_000;

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function buildVaultBlock(req: VaultInjectionRequest): Promise<VaultInjectionResult | null> {
  if (req.mode === 'none') return null;

  let files: { relativePath: string; tags: string[]; content: string; kind: 'md' | 'html' }[];

  if (req.mode === 'all') {
    const vaultFiles = await scanProjectVault(req.project, req.excludePatterns);
    files = readFileContents(req.project, vaultFiles.map(f => f.relativePath));
  } else {
    const paths = (req.filePaths ?? []).filter(Boolean);
    if (paths.length === 0) return null;
    files = readFileContents(req.project, paths);
  }

  if (files.length === 0) return null;

  const lines: string[] = [];
  lines.push('<long_term_memory>');
  lines.push('You have access to the following project vault files. Treat each <vault_file> as authoritative reference material curated by the user. Apply it where relevant. Wikilinks in the form [[Title]] reference other files in this collection.');
  lines.push('');

  for (const f of files) {
    const pathAttr = escapeAttr(f.relativePath);
    const tagsAttr = f.tags.length > 0 ? ` tags="${escapeAttr(f.tags.join(','))}"` : '';
    const typeAttr = ` type="${f.kind}"`;
    lines.push(`<vault_file path="${pathAttr}"${typeAttr}${tagsAttr}>`);
    lines.push(f.content);
    lines.push('</vault_file>');
  }

  lines.push('</long_term_memory>');

  return {
    block: lines.join('\n'),
    fileCount: files.length,
  };
}

function readFileContents(
  project: VaultInjectionRequest['project'],
  paths: string[],
): { relativePath: string; tags: string[]; content: string; kind: 'md' | 'html' }[] {
  const results: { relativePath: string; tags: string[]; content: string; kind: 'md' | 'html' }[] = [];

  for (const rel of paths) {
    const resolved = resolveVaultPath(project, rel);
    if (!resolved) continue;
    const abs = resolved.abs;
    const lower = abs.toLowerCase();
    const isMd = lower.endsWith('.md');
    const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
    if (!isMd && !isHtml) continue;
    if (!fs.existsSync(abs)) continue;

    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch { continue; }

    if (content.length > DEFAULT_PER_FILE_CHAR_CAP) {
      content = content.slice(0, DEFAULT_PER_FILE_CHAR_CAP) + '\n[... truncated]';
    }

    const tags = isMd ? extractTags(content) : [];
    // A linked-folder file gets its real path: `@alias/...` means nothing outside the app.
    const shownPath = resolved.link ? abs.replace(/\\/g, '/') : rel.replace(/\\/g, '/');
    results.push({ relativePath: shownPath, tags, content, kind: isMd ? 'md' : 'html' });
  }

  return results;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function extractTags(content: string): string[] {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return [];
  const raw = match[1];
  for (const line of raw.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key !== 'tags') continue;
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      } catch {
        return value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      }
    }
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export function parseFilePaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
