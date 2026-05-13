import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { getProjectById } from '../db/queries.js';

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
  return { root, abs };
}

interface FileEntry {
  name: string;
  type: 'directory' | 'file' | 'symlink' | 'other';
  size: number | null;
  mtime: number | null;
  hidden: boolean;
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

    const entries: FileEntry[] = [];
    for (const d of dirents) {
      const hidden = d.name.startsWith('.') || DEFAULT_HIDDEN.has(d.name);
      if (hidden && !showHidden && DEFAULT_HIDDEN.has(d.name)) continue;

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

      entries.push({ name: d.name, type, size, mtime, hidden });
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

    if (process.platform === 'win32') {
      if (wantReveal) {
        exec(`explorer.exe /select,"${safe.abs}"`);
      } else if (isDir) {
        exec(`explorer.exe "${safe.abs}"`);
      } else {
        exec(`start "" "${safe.abs}"`, { windowsHide: true });
      }
    } else if (process.platform === 'darwin') {
      exec(wantReveal ? `open -R "${safe.abs}"` : `open "${safe.abs}"`);
    } else {
      // Linux: no portable "reveal" — fall back to opening the containing folder.
      const target = wantReveal ? path.dirname(safe.abs) : safe.abs;
      exec(`xdg-open "${target}"`);
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
