import fs from 'fs';
import path from 'path';

// Returns true if `abs` (an already lexically-resolved path) stays within
// `root` even after resolving symlinks. For a not-yet-created file it checks
// the nearest existing ancestor. Defends against an in-tree symlink that points
// outside the project root (which a lexical `startsWith` check would miss).
// existsSync follows links, so a dangling symlink looked "not created yet" and
// the check fell back to its (in-root) parent — then a write followed the link
// out of the root. lstat sees the link itself; realpath of it then fails → refused.
function lexists(p: string): boolean {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

export function isRealpathWithinRoot(root: string, abs: string): boolean {
  try {
    let probe = abs;
    while (!lexists(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const realRoot = fs.realpathSync(root);
    const realProbe = fs.realpathSync(probe);
    const sep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    return realProbe === realRoot || realProbe.startsWith(sep);
  } catch {
    return false;
  }
}
