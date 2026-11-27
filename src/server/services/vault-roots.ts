import fs from 'fs';
import path from 'path';
import * as queries from '../db/queries.js';
import { scanVault, type VaultFile } from './file-scanner.js';

// The Documents tab can include folders outside the project ("linked
// folders", projects.vault_links). Each shows up as a virtual top-level
// folder `@<alias>`, so a vault path stays one plain project-relative string:
// tag rows, injection paths and MCP arguments keep their shape. Each linked
// folder is its own root — its own .vaultignore, and app tags stored by
// absolute path so every project linking it shares them.
export const LINK_PREFIX = '@';
const ALIAS_RE = /^[\p{L}\p{N}_.-]{1,40}$/u;

export interface VaultLink {
  alias: string;
  /** Canonical absolute folder path, forward slashes. */
  path: string;
}

type VaultProject = Pick<queries.Project, 'id' | 'path' | 'vault_links'>;

export function parseVaultLinks(raw: string | null | undefined): VaultLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((l): l is VaultLink => typeof l?.alias === 'string' && typeof l?.path === 'string')
      : [];
  } catch {
    return [];
  }
}

export interface ResolvedVaultPath {
  /** Absolute root the path lives under: the project folder or a linked folder. */
  root: string;
  /** Path relative to `root`, forward slashes ('' = the root itself). */
  rel: string;
  abs: string;
  link: VaultLink | null;
}

/** Maps a vault path to its real location; null when it escapes its root. */
export function resolveVaultPath(project: VaultProject, vaultPath: string): ResolvedVaultPath | null {
  let rel = (vaultPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  let root = project.path;
  let link: VaultLink | null = null;
  const slash = rel.indexOf('/');
  const head = slash < 0 ? rel : rel.slice(0, slash);
  if (head.startsWith(LINK_PREFIX)) {
    link = parseVaultLinks(project.vault_links).find((l) => LINK_PREFIX + l.alias === head) ?? null;
    if (link) {
      root = link.path;
      rel = slash < 0 ? '' : rel.slice(slash + 1);
    }
  }
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, rel);
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (abs !== rootResolved && !abs.startsWith(rootWithSep)) return null;
  return { root: rootResolved, rel, abs, link };
}

/** Project docs plus every linked folder's docs (paths prefixed `@alias/`). */
export async function scanProjectVault(project: VaultProject, excludePatterns?: string[]): Promise<VaultFile[]> {
  const links = parseVaultLinks(project.vault_links);
  const [files, ...linked] = await Promise.all([
    scanVault(project.path, excludePatterns),
    ...links.map((link) => scanVault(link.path, excludePatterns)),
  ]);
  links.forEach((link, i) => {
    for (const f of linked[i]) {
      files.push({ ...f, relativePath: `${LINK_PREFIX}${link.alias}/${f.relativePath}` });
    }
  });
  return files;
}

// ── App-DB tags: project files in vault_file_tags, linked files shared by absolute path ──

const tagKey = (abs: string) => abs.replace(/\\/g, '/');

export function getProjectVaultTags(project: VaultProject): { files: Record<string, string[]>; colors: Record<string, string> } {
  const tags = queries.getVaultTags(project.id);
  for (const link of parseVaultLinks(project.vault_links)) {
    const base = `${LINK_PREFIX}${link.alias}`;
    for (const [rel, list] of Object.entries(queries.getLinkedVaultTags(tagKey(path.resolve(link.path))))) {
      tags.files[rel ? `${base}/${rel}` : base] = list;
    }
  }
  return tags;
}

export function setVaultPathTags(project: VaultProject, vaultPath: string, tags: string[]): void {
  const r = resolveVaultPath(project, vaultPath);
  if (!r) return;
  if (r.link) queries.setLinkedVaultFileTags(tagKey(r.abs), tags);
  else queries.setVaultFileTags(project.id, vaultPath, tags);
}

export function addVaultPathTag(project: VaultProject, vaultPaths: string[], tag: string): void {
  const own: string[] = [];
  const linked: string[] = [];
  for (const p of vaultPaths) {
    const r = resolveVaultPath(project, p);
    if (!r) continue;
    if (r.link) linked.push(tagKey(r.abs));
    else own.push(p);
  }
  if (own.length > 0) queries.addVaultTagToFiles(project.id, own, tag);
  if (linked.length > 0) queries.addLinkedVaultTagToFiles(linked, tag);
}

/** `from` and `to` must share a root (callers refuse cross-root moves). */
export function moveVaultPathTags(project: VaultProject, from: string, to: string): void {
  const src = resolveVaultPath(project, from);
  const dst = resolveVaultPath(project, to);
  if (!src || !dst) return;
  if (src.link) queries.moveLinkedVaultFileTags(tagKey(src.abs), tagKey(dst.abs));
  else queries.moveVaultFileTags(project.id, from, to);
}

export function deleteVaultPathTags(project: VaultProject, vaultPath: string): void {
  const r = resolveVaultPath(project, vaultPath);
  if (!r) return;
  if (r.link) queries.deleteLinkedVaultFileTags(tagKey(r.abs));
  else queries.deleteVaultFileTags(project.id, vaultPath);
}

// ── Validation of the projects.vault_links body value ──

function isInside(parent: string, child: string): boolean {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

/**
 * Validates a `vault_links` update and returns the JSON to store, with each
 * folder canonicalized (real path, real case, forward slashes) so two
 * projects linking the same folder share its tags. Links already stored are
 * kept as-is without touching the disk, so an unplugged drive doesn't block
 * saving unrelated settings.
 */
export function normalizeVaultLinks(
  raw: unknown,
  project: Pick<queries.Project, 'path' | 'vault_links'>,
): { value: string | null } | { error: string } {
  if (raw === null || raw === '') return { value: null };
  let list: unknown;
  try {
    list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { error: 'vault_links must be a JSON array of { alias, path }' };
  }
  if (!Array.isArray(list)) return { error: 'vault_links must be a JSON array of { alias, path }' };

  const stored = parseVaultLinks(project.vault_links);
  const out: VaultLink[] = [];
  for (const item of list) {
    const alias = typeof item?.alias === 'string' ? item.alias.trim() : '';
    const dir = typeof item?.path === 'string' ? item.path.trim() : '';
    if (!ALIAS_RE.test(alias)) return { error: `Invalid alias "${alias}" (1-40 letters, digits, _ . -)` };
    if (out.some((l) => l.alias.toLowerCase() === alias.toLowerCase())) return { error: `Duplicate alias "${alias}"` };
    if (stored.some((l) => l.alias === alias && l.path === dir)) {
      out.push({ alias, path: dir });
      continue;
    }
    if (!path.isAbsolute(dir)) return { error: `Folder must be an absolute path: ${dir}` };
    let real: string;
    try {
      real = fs.realpathSync.native(dir);
    } catch {
      return { error: `Folder not found: ${dir}` };
    }
    if (!fs.statSync(real).isDirectory()) return { error: `Not a folder: ${dir}` };
    if (isInside(real, project.path) || isInside(project.path, real)) {
      return { error: `Folder overlaps the project folder: ${dir}` };
    }
    if (fs.existsSync(path.join(project.path, LINK_PREFIX + alias))) {
      return { error: `The project already has a folder named ${LINK_PREFIX}${alias}` };
    }
    out.push({ alias, path: tagKey(real) });
  }
  return { value: out.length > 0 ? JSON.stringify(out) : null };
}
