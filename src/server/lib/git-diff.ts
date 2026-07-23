import fs from 'fs';
import nodePath from 'path';
import { createGit } from './git.js';

// Shared git-diff parsing. `range` may be a two-dot/three-dot range
// (`base...target`) or a single commit — with a single commit,
// `git diff <commit>` compares the working tree against it, capturing both
// committed-since and uncommitted changes to TRACKED files.
//
// (parseNumstat/parseNameStatus/listDiffFiles mirror the private copies in
// routes/review.ts; that file is left untouched for now.)

export interface DiffFile {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
  status: string;
}

function parseNumstat(raw: string): Array<{ path: string; insertions: number; deletions: number; binary: boolean }> {
  const out: Array<{ path: string; insertions: number; deletions: number; binary: boolean }> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const [insRaw, delRaw, ...pathParts] = parts;
    const path = pathParts.join('\t');
    const binary = insRaw === '-' || delRaw === '-';
    out.push({
      path,
      insertions: binary ? 0 : parseInt(insRaw, 10) || 0,
      deletions: binary ? 0 : parseInt(delRaw, 10) || 0,
      binary,
    });
  }
  return out;
}

function parseNameStatus(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const code = parts[0];
    // With -M0 we don't expect R/C, but be defensive: rename emits old + new path.
    const path = parts[parts.length - 1];
    map.set(path, code.charAt(0));
  }
  return map;
}

export async function listDiffFiles(git: ReturnType<typeof createGit>, range: string): Promise<DiffFile[]> {
  // -M0 disables rename detection so each rename surfaces as A + D, keeping path strings concrete.
  const [numstat, nameStatus] = await Promise.all([
    git.diff([range, '-M0', '--numstat']),
    git.diff([range, '-M0', '--name-status']),
  ]);
  const statusMap = parseNameStatus(nameStatus);
  return parseNumstat(numstat).map((f) => ({
    ...f,
    status: statusMap.get(f.path) || 'M',
  }));
}

// --- Session diff: tracked changes since a commit PLUS untracked new files ---
//
// `git diff <commit>` is blind to untracked (never-added) files, which a CLI
// session commonly creates. We list them via `ls-files --others` and synthesize
// a "new file" diff from their content (no index mutation, cross-platform).

const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024; // don't slurp huge/blob files into a diff

export interface SessionDiffFile extends DiffFile {
  untracked: boolean;
}

// Synthesize a new-file unified diff from an untracked file's content.
function readUntracked(gitDir: string, relPath: string): { additions: number; binary: boolean; diff: string } {
  const abs = nodePath.join(gitDir, relPath);
  let buf: Buffer;
  try {
    if (fs.statSync(abs).size > MAX_UNTRACKED_BYTES) {
      return { additions: 0, binary: false, diff: `diff --git a/${relPath} b/${relPath}\nnew file (too large to display)\n` };
    }
    buf = fs.readFileSync(abs);
  } catch {
    return { additions: 0, binary: false, diff: '' };
  }
  if (buf.includes(0)) {
    return { additions: 0, binary: true, diff: `diff --git a/${relPath} b/${relPath}\nnew file (binary)\n` };
  }
  const text = buf.toString('utf8');
  const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
  const body = lines.map((l) => `+${l}`).join('\n');
  const diff = `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
  return { additions: lines.length, binary: false, diff };
}

export async function listSessionDiffFiles(gitDir: string, range: string): Promise<SessionDiffFile[]> {
  const git = createGit(gitDir);
  const tracked: SessionDiffFile[] = (await listDiffFiles(git, range)).map((f) => ({ ...f, untracked: false }));
  const trackedPaths = new Set(tracked.map((f) => f.path));

  // ponytail: on the project root (no worktree) this also surfaces untracked
  // files that predate the session — git can't date untracked files. Fresh
  // worktrees start clean so it's exact there; on main it reads as "uncommitted
  // new files", the standard working-changes semantic. Good enough.
  let untrackedRaw = '';
  try {
    untrackedRaw = await git.raw(['ls-files', '--others', '--exclude-standard']);
  } catch {
    /* no untracked / not a repo */
  }
  const untracked: SessionDiffFile[] = [];
  for (const line of untrackedRaw.split('\n')) {
    const path = line.trim();
    if (!path || trackedPaths.has(path)) continue;
    const info = readUntracked(gitDir, path);
    untracked.push({ path, status: 'A', insertions: info.additions, deletions: 0, binary: info.binary, untracked: true });
  }
  return [...tracked, ...untracked];
}

export async function sessionFileDiff(gitDir: string, range: string, file: SessionDiffFile): Promise<string> {
  if (file.untracked) return readUntracked(gitDir, file.path).diff;
  return await createGit(gitDir).diff([range, '-M0', '--', file.path]);
}
