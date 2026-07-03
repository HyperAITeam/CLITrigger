import { Router, Request, Response } from 'express';
import fs from 'fs';
import pathModule from 'path';
import * as queries from '../db/queries.js';
import { isRealpathWithinRoot } from '../utils/path-safety.js';
import {
  scanVault,
  buildVaultGraph,
  readVaultFile,
  writeVaultFile,
  deleteVaultFile,
  renameVaultFile,
  searchVault,
  unhideInVaultIgnore,
} from '../services/file-scanner.js';
import { buildVaultBlock } from '../services/vault-injector.js';

const router = Router();

function getProjectRoot(req: Request, res: Response): { project: queries.Project; root: string } | null {
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
  return { project, root: project.path };
}

function isPathSafe(projectRoot: string, relativePath: string, allowHtml = false): boolean {
  if (!relativePath || typeof relativePath !== 'string') return false;
  const lower = relativePath.toLowerCase();
  const isMd = lower.endsWith('.md');
  const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
  if (!isMd && !(allowHtml && isHtml)) return false;
  const rootResolved = pathModule.resolve(projectRoot);
  const resolved = pathModule.resolve(projectRoot, relativePath);
  const sep = rootResolved.endsWith(pathModule.sep) ? rootResolved : rootResolved + pathModule.sep;
  if (resolved !== rootResolved && !resolved.startsWith(sep)) return false;
  return isRealpathWithinRoot(rootResolved, resolved);
}

// GET /api/projects/:id/vault/files
router.get('/projects/:id/vault/files', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  try {
    const files = scanVault(ctx.root);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to scan vault' });
  }
});

// GET /api/projects/:id/vault/graph
router.get('/projects/:id/vault/graph', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  try {
    const graph = buildVaultGraph(ctx.root);
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: 'Failed to build vault graph' });
  }
});

// GET /api/projects/:id/vault/file?path=...
router.get('/projects/:id/vault/file', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const filePath = req.query.path as string;
  if (!isPathSafe(ctx.root, filePath, true)) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const content = readVaultFile(ctx.root, filePath);
  if (content === null) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.json({ path: filePath, content });
});

// PUT /api/projects/:id/vault/file
router.put('/projects/:id/vault/file', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const { path: filePath, content } = req.body;
  if (!isPathSafe(ctx.root, filePath)) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content must be a string' });
    return;
  }
  const ok = writeVaultFile(ctx.root, filePath, content);
  if (!ok) {
    res.status(500).json({ error: 'Failed to write file' });
    return;
  }
  res.json({ success: true });
});

// POST /api/projects/:id/vault/file
router.post('/projects/:id/vault/file', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const { path: filePath, content } = req.body;
  if (!isPathSafe(ctx.root, filePath)) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const existing = readVaultFile(ctx.root, filePath);
  if (existing !== null) {
    res.status(409).json({ error: 'File already exists' });
    return;
  }
  const ok = writeVaultFile(ctx.root, filePath, content ?? '');
  if (!ok) {
    res.status(500).json({ error: 'Failed to create file' });
    return;
  }
  res.status(201).json({ success: true });
});

// DELETE /api/projects/:id/vault/file
router.delete('/projects/:id/vault/file', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const filePath = (req.query.path ?? req.body?.path) as string;
  if (!isPathSafe(ctx.root, filePath)) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const ok = deleteVaultFile(ctx.root, filePath);
  if (!ok) {
    res.status(404).json({ error: 'File not found or could not be deleted' });
    return;
  }
  res.json({ success: true });
});

// POST /api/projects/:id/vault/rename
router.post('/projects/:id/vault/rename', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const { oldPath, newPath } = req.body;
  if (!isPathSafe(ctx.root, oldPath) || !isPathSafe(ctx.root, newPath)) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const existing = readVaultFile(ctx.root, newPath);
  if (existing !== null) {
    res.status(409).json({ error: 'Target file already exists' });
    return;
  }
  const ok = renameVaultFile(ctx.root, oldPath, newPath);
  if (!ok) {
    res.status(500).json({ error: 'Failed to rename file' });
    return;
  }
  res.json({ success: true });
});

// POST /api/projects/:id/vault/preview
router.post('/projects/:id/vault/preview', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const { mode, filePaths } = req.body;
  if (!mode || !['all', 'selected'].includes(mode)) {
    res.status(400).json({ error: 'mode must be "all" or "selected"' });
    return;
  }
  const sanitizedPaths = Array.isArray(filePaths)
    ? filePaths.filter((p: unknown): p is string => typeof p === 'string' && isPathSafe(ctx.root, p, true))
    : [];
  const result = buildVaultBlock({
    projectRoot: ctx.root,
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
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const q = (req.query.q as string) ?? '';
  const results = searchVault(ctx.root, q);
  res.json({ files: results });
});

// GET /api/projects/:id/vault/ignore
router.get('/projects/:id/vault/ignore', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  try {
    const content = fs.readFileSync(pathModule.join(ctx.root, '.vaultignore'), 'utf-8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

// POST /api/projects/:id/vault/ignore/unhide — re-show a path hidden by
// .vaultignore. Goes beyond removing the exact pattern line: under a broad
// pattern (e.g. the onboarding "ignore everything" `*`), gitignore semantics
// require a negation chain through every ancestor directory, which
// unhideInVaultIgnore generates and verifies.
router.post('/projects/:id/vault/ignore/unhide', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const relRaw = req.body?.path;
  const isDir = !!req.body?.isDir;
  if (typeof relRaw !== 'string' || !relRaw.trim()) {
    res.status(400).json({ error: 'path must be a non-empty string' });
    return;
  }
  const rel = relRaw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const rootResolved = pathModule.resolve(ctx.root);
  const resolved = pathModule.resolve(ctx.root, rel);
  if (!rel || !resolved.startsWith(rootResolved + pathModule.sep)) {
    res.status(400).json({ error: 'path escapes project root' });
    return;
  }
  const igPath = pathModule.join(ctx.root, '.vaultignore');
  let content = '';
  try {
    content = fs.readFileSync(igPath, 'utf-8');
  } catch { /* absent — start from empty */ }
  const next = unhideInVaultIgnore(content, rel, isDir);
  try {
    fs.writeFileSync(igPath, next, 'utf-8');
    res.json({ success: true, content: next });
  } catch {
    res.status(500).json({ error: 'Failed to write .vaultignore' });
  }
});

// PUT /api/projects/:id/vault/ignore
router.put('/projects/:id/vault/ignore', (req: Request, res: Response) => {
  const ctx = getProjectRoot(req, res);
  if (!ctx) return;
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }
  try {
    fs.writeFileSync(pathModule.join(ctx.root, '.vaultignore'), content, 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to write .vaultignore' });
  }
});

export default router;
