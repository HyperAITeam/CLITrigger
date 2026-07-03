import fs from 'fs';
import path from 'path';

// Returns true if `abs` (an already lexically-resolved path) stays within
// `root` even after resolving symlinks. For a not-yet-created file it checks
// the nearest existing ancestor. Defends against an in-tree symlink that points
// outside the project root (which a lexical `startsWith` check would miss).
export function isRealpathWithinRoot(root: string, abs: string): boolean {
  try {
    let probe = abs;
    while (!fs.existsSync(probe)) {
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
