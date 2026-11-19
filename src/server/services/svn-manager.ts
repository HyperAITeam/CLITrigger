import fs from 'fs';
import nodePath from 'path';
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
  changelist?: string;   // native SVN changelist name, when the file belongs to one
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

export interface SvnProperty {
  name: string;           // e.g. "svn:ignore", "svn:externals"
  value: string;
}

class SvnManager {
  // ── Status ───────────────────────────────────────────────────────────────

  async getStatus(dirPath: string, opts: { showUpdates?: boolean } = {}): Promise<SvnStatus> {
    const args = ['status', '--xml'];
    if (opts.showUpdates) args.push('--show-updates');
    args.push(pathArg(dirPath));
    // Both read-only; `info` (branch/revision line) no longer waits for the scan.
    const [{ stdout }, info] = await Promise.all([
      runSvn(args),
      this.getInfo(dirPath).catch(() => null),
    ]);

    const files: SvnStatusFile[] = [];
    let behind = 0;

    // Files in a changelist are wrapped in <changelist name="X"> blocks
    // (siblings of <target>); map path → name so the global entry loop below
    // can attach membership.
    const clMap = new Map<string, string>();
    const clRe = /<changelist\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/changelist>/g;
    const clPathRe = /<entry\b[^>]*\bpath="([^"]+)"/g;
    let cl: RegExpExecArray | null;
    while ((cl = clRe.exec(stdout)) !== null) {
      const name = unescapeXml(cl[1]);
      let p: RegExpExecArray | null;
      while ((p = clPathRe.exec(cl[2])) !== null) clMap.set(unescapeXml(p[1]), name);
    }

    // Each <entry> has a <wc-status> with `item` (working copy state) and
    // possibly a <repos-status> with `item` (incoming changes when -u is set).
    const entryRe = /<entry\b[^>]*\bpath="([^"]+)"[^>]*>([\s\S]*?)<\/entry>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(stdout)) !== null) {
      // Attribute values are XML-escaped: "a&amp;b.txt" is the file a&b.txt.
      const fullPath = unescapeXml(m[1]);
      const inner = m[2];
      const wcMatch = /<wc-status\b[^>]*\bitem="([^"]+)"/.exec(inner);
      const propsMatch = /<wc-status\b[^>]*\bprops="([^"]+)"/.exec(inner);
      const reposMatch = /<repos-status\b[^>]*\bitem="([^"]+)"/.exec(inner);

      const wcChar = mapSvnWcStatusToChar(wcMatch?.[1] ?? 'normal', propsMatch?.[1] ?? 'none');
      if (wcChar !== ' ') {
        const changelist = clMap.get(fullPath);
        files.push({
          path: relativizePath(fullPath, dirPath),
          index: ' ',
          working_dir: wcChar,
          ...(changelist !== undefined ? { changelist } : {}),
        });
      }
      if (reposMatch && reposMatch[1] !== 'none') {
        behind += 1;
      }
    }

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
    const { stdout } = await runSvn(['info', '--xml', pathArg(dirPath)]);
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

  /**
   * `options.url` switches the target from the working copy to a repository
   * URL (used by the externals editor to browse an external's history).
   * Relative external forms (`^/`, `//`, `/`, `../`) are resolved first.
   */
  async getLog(dirPath: string, options: { before?: string; limit?: number; url?: string } = {}): Promise<SvnLogResult> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const target = options.url ? await this.resolveExternalUrl(dirPath, options.url) : pathArg(dirPath);

    // Explicit HEAD:1 — for a working-copy path svn defaults to BASE:1, which
    // hides every server commit newer than the last `svn update`. Later pages
    // start below the oldest revision already shown (`before`), so each page
    // costs one page of XML instead of everything above it.
    let range = 'HEAD:1';
    if (options.before !== undefined) {
      if (!/^\d+$/.test(options.before)) throw new Error('Invalid revision');
      const top = parseInt(options.before, 10) - 1;
      if (top < 1) return { commits: [], hasMore: false };
      range = `${top}:1`;
    }
    const { stdout } = await runSvn([
      'log', '--xml', '-r', range, '-l', String(limit + 1), target,
    ], dirPath);

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

    return { commits: all.slice(0, limit), hasMore: all.length > limit };
  }

  /** HEAD revision of the repository an (external) URL lives in — `svn info URL`. */
  async getUrlHeadRevision(dirPath: string, url: string): Promise<string> {
    const target = await this.resolveExternalUrl(dirPath, url);
    const { stdout } = await runSvn(['info', '--xml', target], dirPath);
    const rev = /<entry\b[^>]*\brevision="([^"]+)"/.exec(stdout)?.[1];
    if (!rev) throw new Error(`Could not read HEAD revision of ${url}`);
    return rev;
  }

  /**
   * Expand the relative URL forms allowed in svn:externals into an absolute
   * URL, then whitelist the scheme so nothing but a URL ever reaches `svn`.
   */
  async resolveExternalUrl(dirPath: string, url: string): Promise<string> {
    let resolved = url.trim();
    if (/^(\^\/|\/\/|\/|\.\.\/)/.test(resolved)) {
      const info = await this.getInfo(dirPath);
      const root = new URL(info.repositoryRoot);
      if (resolved.startsWith('^/')) resolved = info.repositoryRoot.replace(/\/$/, '') + resolved.slice(1);
      else if (resolved.startsWith('//')) resolved = `${root.protocol}${resolved}`;
      else if (resolved.startsWith('/')) resolved = `${root.protocol}//${root.host}${resolved}`;
      else resolved = new URL(resolved, info.url.replace(/\/?$/, '/')).toString();
    }
    if (!/^(https?|svn|svn\+ssh|file):\/\/\S+$/i.test(resolved)) {
      throw new Error(`Invalid SVN URL: ${url}`);
    }
    return resolved;
  }

  async getCommitFiles(dirPath: string, revision: string): Promise<SvnCommitFile[]> {
    if (!/^\d+$/.test(revision)) throw new Error('Invalid revision');
    const { stdout } = await runSvn([
      'log', '--xml', '-v', '-r', revision, pathArg(dirPath),
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

  async getCommitDiff(dirPath: string, revision: string, file?: string, status?: string): Promise<string> {
    if (!/^\d+$/.test(revision)) throw new Error('Invalid revision');
    const rev = parseInt(revision, 10);
    const prev = Math.max(0, rev - 1);

    if (!file) {
      // Whole-revision diff scoped to the working copy.
      const { stdout } = await runSvn(['diff', '--internal-diff', '-r', `${prev}:${rev}`, dirPath], dirPath);
      return stdout;
    }

    // `file` is a repository-root-relative path from `svn log -v`
    // (e.g. "/program/.../foo.prefab"), NOT a local working-copy path —
    // passing it to `svn diff` as a target fails with E155007. Diff the
    // repository URL instead, with a peg revision so added/deleted files
    // resolve correctly: a deleted file no longer exists at `rev`, so peg it
    // at the previous revision.
    const { repositoryRoot } = await this.getInfo(dirPath);
    const url = repositoryRoot + file.split('/').map(encodeURIComponent).join('/');
    const peg = status === 'D' ? prev : rev;
    const { stdout } = await runSvn(
      ['diff', '--internal-diff', '-r', `${prev}:${rev}`, `${url}@${peg}`],
      dirPath,
    );
    return stdout;
  }

  // ── Diff ─────────────────────────────────────────────────────────────────

  async getDiff(dirPath: string, file?: string, revision?: string): Promise<string> {
    const args = ['diff', '--internal-diff'];
    if (revision) {
      if (!/^\d+$/.test(revision)) throw new Error('Invalid revision');
      // Single -r REV (no colon) compares that revision to the working copy.
      args.push('-r', revision);
    }
    // Unlike the other commands, `svn diff` takes a local path literally:
    // "icon@2x.png" works and a trailing '@' breaks it (checked on svn 1.14).
    args.push(file ?? dirPath);
    try {
      const { stdout } = await runSvn(args, dirPath);
      return stdout;
    } catch (err) {
      // svn diff refuses unversioned files; show a new file as all-added.
      if (file && !revision && (await this.statusOf(dirPath, [file])).get(normPath(file))?.item === 'unversioned') {
        const added = addedFileDiff(dirPath, file);
        if (added !== null) return added;
      }
      throw err;
    }
  }

  // ── Properties (LOCAL — reads the working copy, no server contact) ─────────

  async getProperties(dirPath: string, target?: string): Promise<SvnProperty[]> {
    const { stdout } = await runSvn(['proplist', '-v', '--xml', pathArg(target ?? dirPath)], dirPath);
    const props: SvnProperty[] = [];
    const re = /<property\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/property>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null) {
      props.push({ name: m[1], value: unescapeXml(m[2]) });
    }
    return props;
  }

  async setProperty(dirPath: string, name: string, value: string, target?: string): Promise<void> {
    await runSvn(['propset', name, value, pathArg(target ?? dirPath)], dirPath);
  }

  /** `svn status --depth empty` of exactly these paths, keyed by normPath. Empty on failure. */
  private async statusOf(dirPath: string, files: string[]): Promise<Map<string, { item: string; props: string }>> {
    const result = new Map<string, { item: string; props: string }>();
    try {
      const { stdout } = await runSvn(['status', '--xml', '--depth', 'empty', ...files.map(pathArg)], dirPath);
      const entryRe = /<entry\b[^>]*\bpath="([^"]+)"[^>]*>[\s\S]*?<wc-status\b([^>]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = entryRe.exec(stdout)) !== null) {
        result.set(normPath(unescapeXml(m[1])), {
          item: /\bitem="([^"]+)"/.exec(m[2])?.[1] ?? 'normal',
          props: /\bprops="([^"]+)"/.exec(m[2])?.[1] ?? 'none',
        });
      }
    } catch { /* callers fall back to plain behaviour */ }
    return result;
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  async add(dirPath: string, files: string[]): Promise<void> {
    if (files.length === 0) return;
    await runSvn(['add', '--parents', '--force', ...files.map(pathArg)], dirPath);
  }

  /**
   * A props-only target is one whose only local change is a property (e.g. a
   * directory whose svn:externals was bumped). svn's default depth is
   * infinity, so reverting such a directory by path would drag every modified
   * descendant along; it is reverted with --depth empty instead. Best-effort:
   * if detection fails, everything takes the plain -R path.
   */
  async revert(dirPath: string, files: string[]): Promise<void> {
    if (files.length === 0) return;
    const status = await this.statusOf(dirPath, files);
    const propsOnly = files.filter((f) => isPropsOnly(status.get(normPath(f))));
    const rest = files.filter((f) => !propsOnly.includes(f));
    if (propsOnly.length > 0) await runSvn(['revert', '--depth', 'empty', ...propsOnly.map(pathArg)], dirPath);
    if (rest.length > 0) await runSvn(['revert', '-R', ...rest.map(pathArg)], dirPath);
  }

  async remove(dirPath: string, files: string[], keepLocal = false): Promise<void> {
    if (files.length === 0) return;
    const args = ['delete'];
    if (keepLocal) args.push('--keep-local');
    args.push(...files.map(pathArg));
    await runSvn(args, dirPath);
  }

  async resolve(dirPath: string, files: string[], accept: 'working' | 'mine-full' | 'theirs-full' | 'base' = 'working'): Promise<void> {
    if (files.length === 0) return;
    await runSvn(['resolve', `--accept=${accept}`, ...files.map(pathArg)], dirPath);
  }

  /** Assign files to a native changelist, or remove them from any (name === null). */
  async changelist(dirPath: string, name: string | null, files: string[]): Promise<void> {
    if (files.length === 0) return;
    const args = name ? ['changelist', name, ...files.map(pathArg)] : ['changelist', '--remove', ...files.map(pathArg)];
    await runSvn(args, dirPath);
  }

  async commit(dirPath: string, message: string, files?: string[]): Promise<{ revision: string | null }> {
    if (!message.trim()) throw new Error('Commit message is required');
    const args = ['commit', '-m', message];
    if (files && files.length > 0) {
      const status = await this.statusOf(dirPath, files);
      const itemOf = (f: string) => status.get(normPath(f))?.item;
      // svn commit refuses selected files that aren't scheduled yet; like
      // TortoiseSVN, add the new ones and schedule the missing ones for deletion.
      await this.add(dirPath, files.filter((f) => itemOf(f) === 'unversioned'));
      await this.remove(dirPath, files.filter((f) => itemOf(f) === 'missing'));
      // --depth applies to the whole command; explicitly listed files and
      // children still commit, only a directory's unselected descendants stay out.
      // ponytail: a new directory committed together with a props-only one keeps
      // its children uncommitted (depth empty); commit them separately if it bites.
      if (files.some((f) => isPropsOnly(status.get(normPath(f))))) args.push('--depth', 'empty');
      args.push(...files.map(pathArg));
    } else {
      args.push(pathArg(dirPath));
    }
    const { stdout } = await runSvn(args, dirPath);
    // svn prints "Committed revision N." on success
    const revMatch = /Committed revision (\d+)\./.exec(stdout);
    return { revision: revMatch?.[1] ?? null };
  }

  // `onLine` receives each progress line as svn prints it, with the working
  // copy prefix stripped so the UI can show "U    src/foo.cpp" while it runs.
  // Aborting `signal` kills svn and runs cleanup so the copy isn't left locked.
  async update(
    dirPath: string,
    revision?: string,
    onLine?: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<{ revision: string | null; conflicts: string[] }> {
    const args = ['update'];
    if (revision) args.push('-r', revision);
    args.push(pathArg(dirPath));
    let stdout: string;
    try {
      ({ stdout } = await runSvn(args, undefined, onLine && ((line) => {
        const m = UPDATE_LINE.exec(line);
        onLine(m ? `${m[1]} ${relativizePath(m[2], dirPath)}` : line);
      }), signal));
    } catch (err) {
      if (signal?.aborted) await this.cleanup(dirPath).catch(() => { /* reported by the next command */ });
      throw err;
    }
    // A 'C' in any status column is a text/prop/tree conflict. Summary lines
    // ("Updated to revision N.", "  Text conflicts: 1") never match UPDATE_LINE.
    const conflicts: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = UPDATE_LINE.exec(line);
      if (m && m[1].includes('C')) conflicts.push(relativizePath(m[2], dirPath));
    }
    // The summary line is localized on some svn builds; `svn info` is not.
    const revMatch = /(?:At revision|Updated to revision) (\d+)\./.exec(stdout);
    const updatedTo = revMatch?.[1] ?? ((await this.getInfo(dirPath).catch(() => null))?.revision || null);
    return { revision: updatedTo, conflicts };
  }

  async cleanup(dirPath: string): Promise<void> {
    await runSvn(['cleanup', pathArg(dirPath)]);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

// `svn update` progress row: 4 status columns (text, props, lock, tree), a
// space, the path.
const UPDATE_LINE = /^([ADUCGER ][UCG ][B ][C ]) (.+)$/;

/**
 * svn reads "name@rev" as a peg revision, so a path that itself contains '@'
 * (icon@2x.png) needs a trailing '@' to be taken literally.
 */
function pathArg(p: string): string {
  return p.includes('@') ? `${p}@` : p;
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isPropsOnly(s: { item: string; props: string } | undefined): boolean {
  return !!s && mapSvnStatusToChar(s.item) === ' ' && mapSvnWcStatusToChar(s.item, s.props) !== ' ';
}

const ADDED_DIFF_MAX_BYTES = 1024 * 1024;

/** svn-style diff showing an unversioned file as entirely added; null if it can't be read. */
function addedFileDiff(dirPath: string, file: string): string | null {
  const root = nodePath.resolve(dirPath);
  const abs = nodePath.resolve(root, file);
  if (!abs.startsWith(root + nodePath.sep)) return null;
  let stat: fs.Stats;
  try { stat = fs.statSync(abs); } catch { return null; }
  if (!stat.isFile()) return null;
  const name = normPath(file);
  const header = `Index: ${name}\n${'='.repeat(67)}\n--- ${name}\t(nonexistent)\n+++ ${name}\t(working copy)\n`;
  const text = stat.size > ADDED_DIFF_MAX_BYTES ? '\0' : fs.readFileSync(abs, 'utf8');
  if (text.includes('\0')) return `${header}Cannot display: file marked as a binary type.\n`;
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return header;
  return `${header}@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n`;
}

/**
 * Map SVN's `wc-status item` value to a single status char compatible with
 * the git porcelain shape the UI expects in `working_dir`.
 *
 * - normal/none/external/incomplete → space (filtered out by caller)
 * - added → 'A', deleted → 'D', modified → 'M', replaced → 'R'
 * - conflicted → 'C' (SVN's conflict marker)
 * - unversioned → '?', missing → '!', ignored → '!'
 * - obstructed → '!' (filesystem state mismatch)
 */
function mapSvnStatusToChar(item: string): string {
  switch (item) {
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'modified': return 'M';
    case 'replaced': return 'R';
    case 'conflicted': return 'C';
    case 'unversioned': return '?';
    case 'missing': return '!';
    case 'ignored': return '!';
    case 'obstructed': return '!';
    default: return ' ';
  }
}

/**
 * Item status wins; a property-only change (item="normal" props="modified",
 * e.g. an svn:externals bump on a directory) surfaces as M — or C when the
 * property is conflicted — instead of being invisible in the file list.
 */
function mapSvnWcStatusToChar(item: string, props: string): string {
  const itemChar = mapSvnStatusToChar(item);
  if (itemChar !== ' ') return itemChar;
  if (props === 'modified') return 'M';
  if (props === 'conflicted') return 'C';
  return ' ';
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
