import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSessionDiffFiles, sessionFileDiff } from '../git-diff.js';

// Integration tests against a real throwaway git repo — the session diff must
// capture, relative to the session's start commit: (1) changes committed after
// it, (2) uncommitted edits to tracked files, and (3) brand-new UNTRACKED files
// (which `git diff <commit>` silently drops).

function run(cwd: string, cmd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let repo: string;
let base: string;

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
  base = run(repo, 'git rev-parse HEAD').trim();
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
});

describe('listSessionDiffFiles', () => {
  it('captures committed-since, uncommitted tracked edits, and untracked new files', async () => {
    // committed after base
    fs.writeFileSync(path.join(repo, 'committed.txt'), 'c1\nc2\n');
    run(repo, 'git add -A');
    run(repo, 'git commit -m work');
    // uncommitted edit to a tracked file
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'line1\nline2\n');
    // brand-new untracked file
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'u1\nu2\nu3\n');

    const files = await listSessionDiffFiles(repo, base);
    const byPath = new Map(files.map((f) => [f.path, f]));

    expect(byPath.get('committed.txt')?.status).toBe('A');
    expect(byPath.get('tracked.txt')?.status).toBe('M');
    // The regression this guards: untracked files are invisible to `git diff <commit>`.
    expect(byPath.get('untracked.txt')?.status).toBe('A');
    expect(byPath.get('untracked.txt')?.insertions).toBe(3);
  });

  it('synthesizes a new-file diff for untracked files', async () => {
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'hello\nworld\n');
    const files = await listSessionDiffFiles(repo, base);
    const match = files.find((f) => f.path === 'untracked.txt');
    expect(match).toBeDefined();
    const diff = await sessionFileDiff(repo, base, match!);
    expect(diff).toContain('+hello');
    expect(diff).toContain('+world');
  });
});
