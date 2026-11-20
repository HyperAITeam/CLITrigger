import { Router, Request, Response } from 'express';
import fs from 'fs';
import pathModule from 'path';
import * as queries from '../db/queries.js';
import { isRealpathWithinRoot } from '../utils/path-safety.js';
import {
  buildVaultGraph,
  readVaultFile,
  writeVaultFile,
  deleteVaultFile,
  renameVaultFile,
  searchVault,
  unhideInVaultIgnore,
} from '../services/file-scanner.js';
import { buildVaultBlock } from '../services/vault-injector.js';
import {
  resolveVaultPath,
  scanProjectVault,
  getProjectVaultTags,
  setVaultPathTags,
  addVaultPathTag,
  moveVaultPathTags,
  deleteVaultPathTags,
  type ResolvedVaultPath,
} from '../services/vault-roots.js';

const router = Router();

function getProject(req: Request, res: Response): queries.Project | null {
  const projectId = req.params.id as string;
  const project = queries.getProjectById(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  if (!project.path) {
    res.status(400).json({ error: 'Project has no path' });
    return null;
  }
  return project;
}

// A doc path (.md, or .html/.htm with allowHtml) resolved to the project
// root or a linked folder (`@alias/...`); null when it escapes that root.
function resolveDoc(project: queries.Project, relativePath: unknown, allowHtml = false): ResolvedVaultPath | null {
  if (!relativePath || typeof relativePath !== 'string') return null;
  const lower = relativePath.toLowerCase();
  const isMd = lower.endsWith('.md');
  const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
  if (!isMd && !(allowHtml && isHtml)) return null;
  const resolved = resolveVaultPath(project, relativePath);
  if (!resolved || !resolved.rel) return null;
  return isRealpathWithinRoot(resolved.root, resolved.abs) ? resolved : null;
}

// GET /api/projects/:id/vault/files
router.get('/projects/:id/vault/files', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  try {
    const files = scanProjectVault(project);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to scan vault' });
  }
});

// GET /api/projects/:id/vault/graph
router.get('/projects/:id/vault/graph', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  try {
    const graph = buildVaultGraph(scanProjectVault(project));
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: 'Failed to build vault graph' });
  }
});

// GET /api/projects/:id/vault/file?path=...
router.get('/projects/:id/vault/file', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const filePath = req.query.path as string;
  const doc = resolveDoc(project, filePath, true);
  if (!doc) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const content = readVaultFile(doc.root, doc.rel);
  if (content === null) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.json({ path: filePath, content });
});

// PUT /api/projects/:id/vault/file
router.put('/projects/:id/vault/file', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { path: filePath, content } = req.body;
  const doc = resolveDoc(project, filePath);
  if (!doc) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content must be a string' });
    return;
  }
  const ok = writeVaultFile(doc.root, doc.rel, content);
  if (!ok) {
    res.status(500).json({ error: 'Failed to write file' });
    return;
  }
  res.json({ success: true });
});

// POST /api/projects/:id/vault/file
router.post('/projects/:id/vault/file', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { path: filePath, content } = req.body;
  const doc = resolveDoc(project, filePath);
  if (!doc) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const existing = readVaultFile(doc.root, doc.rel);
  if (existing !== null) {
    res.status(409).json({ error: 'File already exists' });
    return;
  }
  const ok = writeVaultFile(doc.root, doc.rel, content ?? '');
  if (!ok) {
    res.status(500).json({ error: 'Failed to create file' });
    return;
  }
  // A new file must not inherit tags left by an earlier file at this path.
  deleteVaultPathTags(project, filePath);
  res.status(201).json({ success: true });
});

// DELETE /api/projects/:id/vault/file
router.delete('/projects/:id/vault/file', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const filePath = (req.query.path ?? req.body?.path) as string;
  const doc = resolveDoc(project, filePath);
  if (!doc) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const ok = deleteVaultFile(doc.root, doc.rel);
  if (!ok) {
    res.status(404).json({ error: 'File not found or could not be deleted' });
    return;
  }
  deleteVaultPathTags(project, filePath);
  res.json({ success: true });
});

// POST /api/projects/:id/vault/rename
router.post('/projects/:id/vault/rename', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { oldPath, newPath } = req.body;
  const src = resolveDoc(project, oldPath);
  const dst = resolveDoc(project, newPath);
  if (!src || !dst) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  if (src.root !== dst.root) {
    res.status(400).json({ error: 'Cannot move a file between the project and a linked folder' });
    return;
  }
  const existing = readVaultFile(dst.root, dst.rel);
  if (existing !== null) {
    res.status(409).json({ error: 'Target file already exists' });
    return;
  }
  const ok = renameVaultFile(src.root, src.rel, dst.rel);
  if (!ok) {
    res.status(500).json({ error: 'Failed to rename file' });
    return;
  }
  moveVaultPathTags(project, oldPath, newPath);
  res.json({ success: true });
});

// ── Graph tags (stored in the app DB, not in the files) ──

const MAX_TAG_LENGTH = 50;

function cleanTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.trim().replace(/^#/, '');
  return tag && tag.length <= MAX_TAG_LENGTH ? tag : null;
}

function isRelativePathString(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length <= 1024;
}

// GET /api/projects/:id/vault/tags
router.get('/projects/:id/vault/tags', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const tags = getProjectVaultTags(project);
  // Drop tags of files deleted outside the app (explorer, git, CLI) so a later
  // file at the same path starts untagged. Skipped while the file's root
  // itself is unreachable (unplugged drive) — that would wipe every tag.
  // ponytail: a file that only vanished temporarily (branch switch) loses its tags too.
  for (const filePath of Object.keys(tags.files)) {
    const r = resolveVaultPath(project, filePath);
    if (!r || !fs.existsSync(r.root) || fs.existsSync(r.abs)) continue;
    deleteVaultPathTags(project, filePath);
    delete tags.files[filePath];
  }
  res.json(tags);
});

// PUT /api/projects/:id/vault/tags/file — { path, tags } replaces that file's tags
router.put('/projects/:id/vault/tags/file', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { path: filePath, tags } = req.body ?? {};
  if (!isRelativePathString(filePath) || !Array.isArray(tags)) {
    res.status(400).json({ error: 'path and tags[] are required' });
    return;
  }
  const cleaned = tags.map(cleanTag);
  if (cleaned.some(t => t === null)) {
    res.status(400).json({ error: `Tags must be 1-${MAX_TAG_LENGTH} characters` });
    return;
  }
  const resolved = resolveVaultPath(project, filePath);
  if (!resolved) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  if (cleaned.length > 0 && !fs.existsSync(resolved.abs)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  setVaultPathTags(project, filePath, [...new Set(cleaned as string[])]);
  res.json({ success: true });
});

// POST /api/projects/:id/vault/tags/bulk — { paths, tag } appends tag to every path
router.post('/projects/:id/vault/tags/bulk', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { paths, tag: rawTag } = req.body ?? {};
  const tag = cleanTag(rawTag);
  if (!Array.isArray(paths) || !paths.every(isRelativePathString) || !tag) {
    res.status(400).json({ error: `paths[] and a 1-${MAX_TAG_LENGTH} character tag are required` });
    return;
  }
  addVaultPathTag(project, paths, tag);
  res.json({ success: true });
});

// PUT /api/projects/:id/vault/tags/color — { tag, color: '#rrggbb' }
router.put('/projects/:id/vault/tags/color', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { tag: rawTag, color } = req.body ?? {};
  const tag = cleanTag(rawTag);
  if (!tag || typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    res.status(400).json({ error: 'tag and a #rrggbb color are required' });
    return;
  }
  queries.setVaultTagColor(project.id, tag, color);
  res.json({ success: true });
});

// POST /api/projects/:id/vault/preview
router.post('/projects/:id/vault/preview', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { mode, filePaths } = req.body;
  if (!mode || !['all', 'selected'].includes(mode)) {
    res.status(400).json({ error: 'mode must be "all" or "selected"' });
    return;
  }
  const sanitizedPaths = Array.isArray(filePaths)
    ? filePaths.filter((p: unknown): p is string => typeof p === 'string' && resolveDoc(project, p, true) !== null)
    : [];
  const result = buildVaultBlock({
    project,
    mode,
    filePaths: sanitizedPaths,
  });
  res.json({
    block: result?.block ?? '',
    fileCount: result?.fileCount ?? 0,
    charCount: result?.block?.length ?? 0,
  });
});

// GET /api/projects/:id/vault/search?q=...
router.get('/projects/:id/vault/search', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const q = (req.query.q as string) ?? '';
  const results = q.trim() ? searchVault(scanProjectVault(project), q) : [];
  res.json({ files: results });
});

// GET /api/projects/:id/vault/ignore
router.get('/projects/:id/vault/ignore', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  try {
    const content = fs.readFileSync(pathModule.join(project.path, '.vaultignore'), 'utf-8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

// Path inside its root (project folder or linked folder) for the hide/unhide
// endpoints below — each root keeps its own .vaultignore. Null for the root
// itself or a path escaping it.
function resolveIgnoreTarget(project: queries.Project, raw: unknown): ResolvedVaultPath | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const resolved = resolveVaultPath(project, raw.replace(/\/+$/, ''));
  return resolved && resolved.rel ? resolved : null;
}

// POST /api/projects/:id/vault/ignore/hide — append an anchored exact-path
// pattern (`/path`, directories get a trailing `/`) to the .vaultignore of
// the path's root. No-op if the pattern is already present.
router.post('/projects/:id/vault/ignore/hide', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const target = resolveIgnoreTarget(project, req.body?.path);
  if (!target) {
    res.status(400).json({ error: 'path must be a non-empty path inside the project or a linked folder' });
    return;
  }
  const igPath = pathModule.join(target.root, '.vaultignore');
  let content = '';
  try {
    content = fs.readFileSync(igPath, 'utf-8');
  } catch { /* absent — start from empty */ }
  const pattern = '/' + target.rel + (req.body?.isDir ? '/' : '');
  if (content.split(/\r?\n/).map((l) => l.trim()).includes(pattern)) {
    res.json({ success: true });
    return;
  }
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  try {
    fs.writeFileSync(igPath, content + sep + pattern + '\n', 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to write .vaultignore' });
  }
});

// POST /api/projects/:id/vault/ignore/unhide — re-show a path hidden by
// .vaultignore. Goes beyond removing the exact pattern line: under a broad
// pattern (e.g. the onboarding "ignore everything" `*`), gitignore semantics
// require a negation chain through every ancestor directory, which
// unhideInVaultIgnore generates and verifies.
router.post('/projects/:id/vault/ignore/unhide', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const target = resolveIgnoreTarget(project, req.body?.path);
  if (!target) {
    res.status(400).json({ error: 'path must be a non-empty path inside the project or a linked folder' });
    return;
  }
  const isDir = !!req.body?.isDir;
  const igPath = pathModule.join(target.root, '.vaultignore');
  let content = '';
  try {
    content = fs.readFileSync(igPath, 'utf-8');
  } catch { /* absent — start from empty */ }
  const next = unhideInVaultIgnore(content, target.rel, isDir);
  try {
    fs.writeFileSync(igPath, next, 'utf-8');
    res.json({ success: true, content: next });
  } catch {
    res.status(500).json({ error: 'Failed to write .vaultignore' });
  }
});

// PUT /api/projects/:id/vault/ignore
router.put('/projects/:id/vault/ignore', (req: Request, res: Response) => {
  const project = getProject(req, res);
  if (!project) return;
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }
  try {
    fs.writeFileSync(pathModule.join(project.path, '.vaultignore'), content, 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to write .vaultignore' });
  }
});

export default router;
