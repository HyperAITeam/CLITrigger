import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { osOpenPath } from '../utils/open-path.js';
import { isRealpathWithinRoot } from '../utils/path-safety.js';
import { getProjectById } from '../db/queries.js';
import { loadVaultIgnore } from '../services/file-scanner.js';

const router = Router();

const TEXT_SIZE_CAP = 2 * 1024 * 1024; // 2MB
const BINARY_SIZE_CAP = 50 * 1024 * 1024; // 50MB
const DEFAULT_HIDDEN = new Set(['.git', 'node_modules', '.worktrees', '.DS_Store']);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

// Resolve a request's `path` query against the project root, enforcing that
// the resolved path stays inside the root. Returns null on any traversal /
// missing-project failure (caller should 403/404 accordingly).
function resolveSafe(projectId: string, relPath: string): { root: string; abs: string } | null {
  const project = getProjectById(projectId);
  if (!project) return null;
  const root = path.resolve(project.path);
  const rel = (relPath ?? '').replace(/^[\\/]+/, '');
  const abs = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  // Resolve symlinks too, so an in-tree symlink can't point outside the root.
  if (!isRealpathWithinRoot(root, abs)) return null;
  return { root, abs };
}

interface FileEntry {
  name: string;
  type: 'directory' | 'file' | 'symlink' | 'other';
  size: number | null;
  mtime: number | null;
  hidden: boolean;
  // True only when hidden specifically by a `.vaultignore` pattern (not for
  // dotfiles / DEFAULT_HIDDEN), so the UI can offer "unhide" — removing the
  // pattern would actually re-reveal it.
  ignored: boolean;
}

// GET /api/projects/:id/files?path=<rel>&showHidden=1
router.get('/:id/files', (req: Request<{ id: string }>, res: Response) => {
  try {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const showHidden = req.query.showHidden === '1' || req.query.showHidden === 'true';
    const safe = resolveSafe(req.params.id, relPath);
    if (!safe) {
      res.status(403).json({ error: 'Path is outside project root or project not found' });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(safe.abs);
    } catch {
      res.status(404).json({ error: 'Path does not exist' });
      return;
    }
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(safe.abs, { withFileTypes: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'readdir failed';
      res.status(500).json({ error: message });
      return;
    }

    const ig = loadVaultIgnore(safe.root);

    const entries: FileEntry[] = [];
    for (const d of dirents) {
      const rel = (relPath ? `${relPath}/${d.name}` : d.name).replace(/\\/g, '/');
      const ignored = ig.ignores(d.isDirectory() ? rel + '/' : rel);
      const hidden = d.name.startsWith('.') || DEFAULT_HIDDEN.has(d.name) || ignored;
      if (!showHidden && (DEFAULT_HIDDEN.has(d.name) || ignored)) continue;

      let type: FileEntry['type'] = 'other';
      if (d.isDirectory()) type = 'directory';
      else if (d.isFile()) type = 'file';
      else if (d.isSymbolicLink()) type = 'symlink';

      let size: number | null = null;
      let mtime: number | null = null;
      try {
        const child = fs.statSync(path.join(safe.abs, d.name));
        size = child.isDirectory() ? null : child.size;
        mtime = child.mtimeMs;
      } catch { /* skip stat failures (permission denied, broken symlink) */ }

      entries.push({ name: d.name, type, size, mtime, hidden, ignored });
    }

    // Directories first, then files; case-insensitive name sort within each group.
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    res.json({ path: relPath, root: safe.root, entries });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/files/content?path=<rel> — returns text content + metadata.
router.get('/:id/files/content', (req: Request<{ id: string }>, res: Response) => {
  try {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const safe = resolveSafe(req.params.id, relPath);
    if (!safe) {
      res.status(403).json({ error: 'Path is outside project root or project not found' });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(safe.abs);
    } catch {
      res.status(404).json({ error: 'File does not exist' });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: 'Path is not a file' });
      return;
    }
    if (stat.size > TEXT_SIZE_CAP) {
      res.status(413).json({ error: 'File too large for preview', size: stat.size, cap: TEXT_SIZE_CAP });
      return;
    }

    const ext = path.extname(safe.abs).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    const looksBinary = !!mime && !mime.startsWith('text/') && mime !== 'image/svg+xml';

    const buffer = fs.readFileSync(safe.abs);

    // Heuristic: if any NUL byte in the first 8KB, treat as binary.
    let isBinary = looksBinary;
    if (!isBinary) {
      const probe = buffer.subarray(0, Math.min(buffer.length, 8192));
      for (let i = 0; i < probe.length; i++) {
        if (probe[i] === 0) { isBinary = true; break; }
      }
    }

    if (isBinary) {
      res.json({
        path: relPath,
        size: stat.size,
        mtime: stat.mtimeMs,
        binary: true,
        mime: mime || 'application/octet-stream',
      });
      return;
    }

    res.json({
      path: relPath,
      size: stat.size,
      mtime: stat.mtimeMs,
      binary: false,
      content: buffer.toString('utf8'),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// PUT /api/projects/:id/files/content — overwrite a text file's contents.
// Body: { path: string, content: string, mtime: number } where `mtime` is the
// disk mtimeMs the client last observed. If the file's current mtime on disk
// does not match, we 409 so the client can prompt the user to reload (prevents
// stomping changes made by a CLI subprocess or external editor).
router.put('/:id/files/content', (req: Request<{ id: string }>, res: Response) => {
  try {
    const body = req.body as { path?: unknown; content?: unknown; mtime?: unknown } | undefined;
    const relPath = typeof body?.path === 'string' ? body.path : '';
    const content = typeof body?.content === 'string' ? body.content : null;
    const expectedMtime = typeof body?.mtime === 'number' ? body.mtime : null;
    if (!relPath || content === null || expectedMtime === null) {
      res.status(400).json({ error: 'path, content, and mtime are required' });
      return;
    }
    const safe = resolveSafe(req.params.id, relPath);
    if (!safe) {
      res.status(403).json({ error: 'Path is outside project root or project not found' });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(safe.abs);
    } catch {
      res.status(404).json({ error: 'File does not exist' });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: 'Path is not a file' });
      return;
    }

    // Block binary edits — clients should not POST text content for files we
    // serve as binary. SVG is the exception (text-based XML).
    const ext = path.extname(safe.abs).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (mime && !mime.startsWith('text/') && mime !== 'image/svg+xml') {
      res.status(415).json({ error: 'Binary files cannot be edited as text' });
      return;
    }

    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > TEXT_SIZE_CAP) {
      res.status(413).json({ error: 'Content too large', size: byteLength, cap: TEXT_SIZE_CAP });
      return;
    }

    // Conflict check: did anyone else write since we loaded?
    if (stat.mtimeMs !== expectedMtime) {
      res.status(409).json({
        error: 'File changed on disk since it was loaded',
        currentMtime: stat.mtimeMs,
        expectedMtime,
      });
      return;
    }

    try {
      fs.writeFileSync(safe.abs, content, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'write failed';
      res.status(500).json({ error: message });
      return;
    }

    const after = fs.statSync(safe.abs);
    res.json({ path: relPath, size: after.size, mtime: after.mtimeMs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/files/binary?path=<rel> — streams binary file with
// proper Content-Type so <img>/<video> tags can render it inline.
router.get('/:id/files/binary', (req: Request<{ id: string }>, res: Response) => {
  try {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const safe = resolveSafe(req.params.id, relPath);
    if (!safe) {
      res.status(403).json({ error: 'Path is outside project root or project not found' });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(safe.abs);
    } catch {
      res.status(404).json({ error: 'File does not exist' });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: 'Path is not a file' });
      return;
    }
    if (stat.size > BINARY_SIZE_CAP) {
      res.status(413).json({ error: 'File too large to stream', size: stat.size, cap: BINARY_SIZE_CAP });
      return;
    }

    const ext = path.extname(safe.abs).toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    // SVG can carry scripts; sandbox it so opening the URL directly can't run JS.
    if (mime === 'image/svg+xml') res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.sendFile(safe.abs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:id/files/open  body: { path: string, mode?: 'open' | 'reveal' }
// Opens the target with the OS default app, or reveals it in the file manager.
router.post('/:id/files/open', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { path: relPath, mode } = (req.body ?? {}) as { path?: unknown; mode?: unknown };
    if (typeof relPath !== 'string') {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const safe = resolveSafe(req.params.id, relPath);
    if (!safe) {
      res.status(403).json({ error: 'Path is outside project root or project not found' });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(safe.abs);
    } catch {
      res.status(404).json({ error: 'Path does not exist' });
      return;
    }

    const isDir = stat.isDirectory();
    // reveal is only meaningful for files; for directories it degrades to "open".
    const wantReveal = mode === 'reveal' && !isDir;

    osOpenPath(safe.abs, { reveal: wantReveal });

    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /:id/files/move — move (or rename) a file/directory within the project.
// `from` and `to` are project-root-relative paths; `to` is the full new path
// (caller composes destFolder + '/' + name). Both are path-traversal-guarded.
router.post('/:id/files/move', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { from, to } = (req.body ?? {}) as { from?: unknown; to?: unknown };
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) {
      res.status(400).json({ error: 'from and to (relative paths) are required' });
      return;
    }
    const src = resolveSafe(req.params.id, from);
    const dst = resolveSafe(req.params.id, to);
    if (!src || !dst) {
      res.status(403).json({ error: 'Path is outside project root or project not found' });
      return;
    }
    const fromNorm = from.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const toNorm = to.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (fromNorm === toNorm) {
      res.status(400).json({ error: 'Source and destination are the same' });
      return;
    }
    // Block moving a directory into itself or one of its descendants.
    if (toNorm === fromNorm || toNorm.startsWith(fromNorm + '/')) {
      res.status(400).json({ error: 'Cannot move a folder into itself' });
      return;
    }
    if (!fs.existsSync(src.abs)) {
      res.status(404).json({ error: 'Source does not exist' });
      return;
    }
    if (fs.existsSync(dst.abs)) {
      res.status(409).json({ error: 'Destination already exists' });
      return;
    }
    const dstParent = path.dirname(dst.abs);
    if (!fs.existsSync(dstParent) || !fs.statSync(dstParent).isDirectory()) {
      res.status(400).json({ error: 'Destination folder does not exist' });
      return;
    }
    fs.renameSync(src.abs, dst.abs);
    res.json({ success: true, from: fromNorm, to: toNorm });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
