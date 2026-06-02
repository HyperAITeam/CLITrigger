import { runSvn } from '../lib/svn.js';

/**
 * SVN working-copy manager.
 *
 * Mirrors the parts of `worktreeManager` that the GUI consumes (status, log,
 * diff, commit) so the existing `DiffViewer` / file list components can
 * render SVN data with no per-VCS branching at the leaf level. Because SVN
 * has no staging area, status entries always have `index === ' '` and the
 * `working_dir` slot carries the SVN status char.
 *
 * XML parsing uses regex against svn's stable --xml schema; this avoids
 * pulling in a new XML dependency for what is a very predictable format.
 */

export interface SvnStatusFile {
  path: string;
  index: string;
  working_dir: string;
}

export interface SvnStatus {
  branch: string;          // best-effort: relative URL ("^/trunk", "^/branches/x") or empty
  tracking: string | null; // full repo URL ("https://example.com/svn/repo/trunk") or null
  ahead: number;           // SVN doesn't model "ahead" — kept for shape parity, always 0
  behind: number;          // count of incoming changes from `svn status -u`, when available
  files: SvnStatusFile[];
  revision: string | null; // working copy base revision
}

export interface SvnLogEntry {
  hash: string;          // revision number as string ("12345")
  parentHashes: string[]; // [previous-rev] for non-first commits, [] otherwise
  refs: string[];        // unused for SVN — kept for shape parity
  message: string;
  author: string;
  date: string;          // ISO 8601 from svn (it already emits ISO)
}

export interface SvnLogResult {
  commits: SvnLogEntry[];
  hasMore: boolean;
}

export interface SvnCommitFile {
  path: string;
  status: string;         // 'A' | 'M' | 'D' | 'R' (mapped from svn action chars)
  additions: number;      // SVN doesn't report per-file line counts in log; 0
  deletions: number;
  oldPath?: string;       // present for copies/moves
}

class SvnManager {
  // ── Status ───────────────────────────────────────────────────────────────

  async getStatus(dirPath: string, opts: { showUpdates?: boolean } = {}): Promise<SvnStatus> {
    const args = ['status', '--xml'];
    if (opts.showUpdates) args.push('--show-updates');
    args.push(dirPath);
    const { stdout } = await runSvn(args);

    const files: SvnStatusFile[] = [];
    let behind = 0;

    // Each <entry> has a <wc-status> with `item` (working copy state) and
    // possibly a <repos-status> with `item` (incoming changes when -u is set).
    const entryRe = /<entry\b[^>]*\bpath="([^"]+)"[^>]*>([\s\S]*?)<\/entry>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(stdout)) !== null) {
      const fullPath = m[1];
      const inner = m[2];
      const wcMatch = /<wc-status\b[^>]*\bitem="([^"]+)"/.exec(inner);
      const reposMatch = /<repos-status\b[^>]*\bitem="([^"]+)"/.exec(inner);

      const wcChar = mapSvnStatusToChar(wcMatch?.[1] ?? 'normal');
      if (wcChar !== ' ') {
        files.push({
          path: relativizePath(fullPath, dirPath),
          index: ' ',
          working_dir: wcChar,
        });
      }
      if (reposMatch && reposMatch[1] !== 'none') {
        behind += 1;
      }
    }

    // Working copy info for branch/tracking/revision display.
    const info = await this.getInfo(dirPath).catch(() => null);
    return {
      branch: info?.relativeUrl ?? '',
      tracking: info?.url ?? null,
      ahead: 0,
      behind,
      files,
      revision: info?.revision ?? null,
    };
  }

  // ── Info ─────────────────────────────────────────────────────────────────

  async getInfo(dirPath: string): Promise<{
    url: string;
    relativeUrl: string;
    repositoryRoot: string;
    revision: string;
  }> {
    const { stdout } = await runSvn(['info', '--xml', dirPath]);
    const url = extractTag(stdout, 'url') ?? '';
    const relativeUrl = extractTag(stdout, 'relative-url') ?? '';
    const repositoryRoot = extractTag(stdout, 'root') ?? '';
    const entryMatch = /<entry\b[^>]*\brevision="([^"]+)"/.exec(stdout);
    return {
      url,
      relativeUrl,
      repositoryRoot,
      revision: entryMatch?.[1] ?? '',
    };
  }

  // ── Log ──────────────────────────────────────────────────────────────────

  async getLog(dirPath: string, options: { skip?: number; limit?: number } = {}): Promise<SvnLogResult> {
    const skip = Math.max(0, options.skip ?? 0);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

    // SVN has no native skip. Approximate by fetching limit+skip+1 from HEAD
    // and slicing. For deep history this is wasteful, but pages 0–10 cost
    // <1MB of XML against typical repos, which is acceptable.
    const fetchCount = skip + limit + 1;
    const { stdout } = await runSvn([
      'log', '--xml', '-l', String(fetchCount), dirPath,
    ]);

    const all: SvnLogEntry[] = [];
    const logRe = /<logentry\b[^>]*\brevision="([^"]+)"[^>]*>([\s\S]*?)<\/logentry>/g;
    let m: RegExpExecArray | null;
    while ((m = logRe.exec(stdout)) !== null) {
      const rev = m[1];
      const inner = m[2];
      const author = extractTag(inner, 'author') ?? '';
      const date = extractTag(inner, 'date') ?? '';
      const message = extractTag(inner, 'msg') ?? '';
      const parentRev = String(Math.max(0, parseInt(rev, 10) - 1));
      all.push({
        hash: rev,
        parentHashes: parentRev === '0' ? [] : [parentRev],
        refs: [],
        message,
        author,
        date,
      });
    }

    const sliced = all.slice(skip, skip + limit + 1);
    const hasMore = sliced.length > limit;
    return {
      commits: hasMore ? sliced.slice(0, limit) : sliced,
      hasMore,
    };
  }

  async getCommitFiles(dirPath: string, revision: string): Promise<SvnCommitFile[]> {
    if (!/^\d+$/.test(revision)) throw new Error('Invalid revision');
    const { stdout } = await runSvn([
      'log', '--xml', '-v', '-r', revision, dirPath,
    ]);

    const files: SvnCommitFile[] = [];
    const pathRe = /<path\b([^>]*)>([\s\S]*?)<\/path>/g;
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(stdout)) !== null) {
      const attrs = m[1];
      const text = unescapeXml(m[2].trim());
      const action = /\baction="([^"]+)"/.exec(attrs)?.[1] ?? 'M';
      const copyfromPath = /\bcopyfrom-path="([^"]+)"/.exec(attrs)?.[1];
      files.push({
        path: text,
        status: mapSvnActionToStatus(action),
        additions: 0,
        deletions: 0,
        ...(copyfromPath ? { oldPath: copyfromPath } : {}),
      });
    }
    return files;
  }

  async getCommitDiff(dirPath: string, revision: string, file?: string): Promise<string> {
    if (!/^\d+$/.test(revision)) throw new Error('Invalid revision');
    const prev = Math.max(0, parseInt(revision, 10) - 1);
    if (prev === 0) {
      // Root commit — diff against empty tree by listing the new content.
      // svn diff -r 0:1 works but produces full-add output, which is fine.
    }
    const args = ['diff', '--internal-diff', '-r', `${prev}:${revision}`];
    if (file) args.push(file);
    else args.push(dirPath);
    const { stdout } = await runSvn(args, dirPath);
    return stdout;
  }

  // ── Diff ─────────────────────────────────────────────────────────────────

  async getDiff(dirPath: string, file?: string): Promise<string> {
    const args = ['diff', '--internal-diff'];
    if (file) args.push(file);
    else args.push(dirPath);
    const { stdout } = await runSvn(args, dirPath);
    return stdout;
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  async add(dirPath: string, files: string[]): Promise<void> {
    if (files.length === 0) return;
    await runSvn(['add', '--parents', '--force', ...files], dirPath);
  }

  async revert(dirPath: string, files: string[]): Promise<void> {
    if (files.length === 0) return;
    await runSvn(['revert', '-R', ...files], dirPath);
  }

  async remove(dirPath: string, files: string[], keepLocal = false): Promise<void> {
    if (files.length === 0) return;
    const args = ['delete'];
    if (keepLocal) args.push('--keep-local');
    args.push(...files);
    await runSvn(args, dirPath);
  }

  async resolve(dirPath: string, files: string[], accept: 'working' | 'mine-full' | 'theirs-full' | 'base' = 'working'): Promise<void> {
    if (files.length === 0) return;
    await runSvn(['resolve', `--accept=${accept}`, ...files], dirPath);
  }

  async commit(dirPath: string, message: string, files?: string[]): Promise<{ revision: string | null; output: string }> {
    if (!message.trim()) throw new Error('Commit message is required');
    const args = ['commit', '-m', message];
    if (files && files.length > 0) args.push(...files);
    else args.push(dirPath);
    const { stdout } = await runSvn(args, dirPath);
    // svn prints "Committed revision N." on success
    const revMatch = /Committed revision (\d+)\./.exec(stdout);
    return { revision: revMatch?.[1] ?? null, output: stdout };
  }

  async update(dirPath: string, revision?: string): Promise<{ revision: string | null; output: string }> {
    const args = ['update'];
    if (revision) args.push('-r', revision);
    args.push(dirPath);
    const { stdout } = await runSvn(args);
    const revMatch = /(?:At revision|Updated to revision) (\d+)\./.exec(stdout);
    return { revision: revMatch?.[1] ?? null, output: stdout };
  }

  async cleanup(dirPath: string): Promise<void> {
    await runSvn(['cleanup', dirPath]);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map SVN's `wc-status item` value to a single status char compatible with
 * the git porcelain shape the UI expects in `working_dir`.
 *
 * - normal/none/external/incomplete → space (filtered out by caller)
 * - added → 'A', deleted → 'D', modified → 'M', replaced → 'R'
 * - conflicted → 'U' (git's "unmerged")
 * - unversioned → '?', missing → '!', ignored → '!'
 * - obstructed → '!' (filesystem state mismatch)
 */
function mapSvnStatusToChar(item: string): string {
  switch (item) {
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'modified': return 'M';
    case 'replaced': return 'R';
    case 'conflicted': return 'U';
    case 'unversioned': return '?';
    case 'missing': return '!';
    case 'ignored': return '!';
    case 'obstructed': return '!';
    default: return ' ';
  }
}

function mapSvnActionToStatus(action: string): string {
  switch (action) {
    case 'A': return 'A';
    case 'D': return 'D';
    case 'M': return 'M';
    case 'R': return 'R';
    default: return action;
  }
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  if (!m) return undefined;
  return unescapeXml(m[1]);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Convert an absolute path emitted by svn to a path relative to the working
 * copy root, using forward slashes (matches git status output).
 */
function relativizePath(fullPath: string, wcRoot: string): string {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const f = norm(fullPath);
  const r = norm(wcRoot);
  if (f === r) return '.';
  if (f.toLowerCase().startsWith(r.toLowerCase() + '/')) {
    return f.slice(r.length + 1);
  }
  return f;
}

export const svnManager = new SvnManager();
