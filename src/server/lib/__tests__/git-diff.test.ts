import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listDiffFiles, snapshotWorkingTree } from '../git-diff.js';
import { createGit } from '../git.js';

// The session Diff must show exactly what the session changed since it started,
// even on a shared/main checkout. A snapshot taken at start and diffed against a
// snapshot taken "now" must: exclude files already dirty BEFORE start (the bug
// the plain start-SHA approach had), and include committed-since, uncommitted
// tracked edits, and brand-new untracked files created after start.

function run(cwd: string, cmd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'clitrigger-session-diff-'));
  run(repo, 'git init -b main');
  run(repo, 'git config user.name tester');
  run(repo, 'git config user.email tester@example.com');
  run(repo, 'git config commit.gpgsign false');
  run(repo, 'git config core.autocrlf false');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'line1\n');
  run(repo, 'git add -A');
  run(repo, 'git commit -m base');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
});

async function diffPaths(base: string): Promise<Map<string, string>> {
  const now = (await snapshotWorkingTree(repo))!;
  const files = await listDiffFiles(createGit(repo), `${base}..${now}`);
  return new Map(files.map((f) => [f.path, f.status]));
}

describe('session diff via working-tree snapshots', () => {
  it('excludes pre-existing dirt; includes committed, uncommitted, and new untracked', async () => {
    // Dirty state that exists BEFORE the session starts.
    fs.writeFileSync(path.join(repo, 'preexisting.txt'), 'was here first\n'); // untracked before start

    const base = (await snapshotWorkingTree(repo))!; // <-- session start
    expect(base).toBeTruthy();

    // The session's own work:
    fs.writeFileSync(path.join(repo, 'committed.txt'), 'c\n');
    run(repo, 'git add -A');
    run(repo, 'git commit -m work');                              // committed after start
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'line1\nline2\n'); // uncommitted tracked edit
    fs.writeFileSync(path.join(repo, 'fresh.txt'), 'brand new\n');      // new untracked after start

    const changed = await diffPaths(base);

    // The regression the user hit: dirt from before start must NOT appear.
    expect(changed.has('preexisting.txt')).toBe(false);
    // Everything the session did must appear.
    expect(changed.get('committed.txt')).toBe('A');
    expect(changed.get('tracked.txt')).toBe('M');
    expect(changed.get('fresh.txt')).toBe('A');
  });

  it('reports no changes when the session touched nothing', async () => {
    const base = (await snapshotWorkingTree(repo))!;
    const changed = await diffPaths(base);
    expect(changed.size).toBe(0);
  });
});
