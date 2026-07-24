import fs from 'fs';
import os from 'os';
import nodePath from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createGit } from './git.js';

const execFileAsync = promisify(execFile);

// Shared git-diff parsing. `range` may be a two-dot/three-dot range
// (`base...target`, `A..B`) or a single commit.
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

// --- Working-tree snapshot ---
//
// A bare HEAD SHA can only time-scope COMMITTED history — git has no timestamp
// on working-tree state, so `git diff <sha>` for a shared/main checkout also
// surfaces uncommitted/untracked changes that predate the session. To scope a
// session's Diff to exactly "what changed since it started", we snapshot the
// FULL working state (tracked + staged + untracked, honoring .gitignore) at
// start and again at diff time, then diff snapshot-to-snapshot.
//
// The snapshot is a commit object built via a throwaway index — the repo's real
// index and working tree are never touched. The resulting commit is dangling
// (no ref) and git will GC it in due course, which is fine for a session's life.
//
// The throwaway index is seeded by COPYING the repo's real index, not by
// `read-tree HEAD`. A read-tree index has no stat cache, so the following
// `git add -A` must re-hash every file in the working tree — cost scales with
// total repo size and blocks on huge repos. Copying the real index carries its
// per-file mtime/size cache over, so `git add -A` only re-hashes what actually
// changed (git-status speed). The final tree is identical either way — `add -A`
// syncs the index to the full working-tree state regardless of its seed.
export async function snapshotWorkingTree(gitDir: string): Promise<string | null> {
  const tmpIndex = nodePath.join(os.tmpdir(), `clitrigger-snap-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}.idx`);
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tmpIndex,
    // Ensure commit-tree never fails on a repo lacking a configured identity.
    GIT_AUTHOR_NAME: 'clitrigger', GIT_AUTHOR_EMAIL: 'clitrigger@local',
    GIT_COMMITTER_NAME: 'clitrigger', GIT_COMMITTER_EMAIL: 'clitrigger@local',
  };
  const opts = { cwd: gitDir, env, encoding: 'utf8' as const, maxBuffer: 64 * 1024 * 1024 };
  const git = async (args: string[]) => (await execFileAsync('git', args, opts)).stdout.trim();
  try {
    let seeded = false;
    try {
      // Locate the real index WITHOUT GIT_INDEX_FILE set: `rev-parse --git-path
      // index` honors that env var and would otherwise return our (nonexistent)
      // temp index. cwd=gitDir resolves the right worktree's index.
      const revParse = await execFileAsync('git', ['rev-parse', '--git-path', 'index'], { cwd: gitDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const realIndex = nodePath.resolve(gitDir, revParse.stdout.trim());
      if (fs.existsSync(realIndex)) {
        fs.copyFileSync(realIndex, tmpIndex);
        seeded = true;
      }
    } catch { /* fall back to read-tree below */ }
    if (!seeded) await git(['read-tree', 'HEAD']);

    // Disable fsmonitor / untracked-cache for this add: the copied index carries
    // those extensions over, and a stale cache would make `add -A` miss files
    // created after the real index was last refreshed (e.g. new untracked files).
    // The per-entry stat cache still applies, so unchanged files aren't re-hashed.
    await git(['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'add', '-A']);
    const tree = await git(['write-tree']);
    const commit = await git(['commit-tree', tree, '-p', 'HEAD', '-m', 'clitrigger session snapshot']);
    return commit || null;
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmpIndex, { force: true }); } catch { /* best-effort */ }
  }
}
