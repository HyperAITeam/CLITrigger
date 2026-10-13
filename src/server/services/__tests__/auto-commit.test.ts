import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { worktreeManager } from '../worktree-manager.js';

// Integration tests against a real throwaway repo + worktree: the auto-commit
// helpers are the only thing standing between a dirty worktree and
// `worktree remove --force` after a merge, so exercise the real git state.

function run(cwd: string, cmd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let repo: string;
let worktree: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'clitrigger-auto-commit-'));
  run(repo, 'git init -b main');
  run(repo, 'git config user.name tester');
  run(repo, 'git config user.email tester@example.com');
  run(repo, 'git config commit.gpgsign false');
  run(repo, 'git config core.autocrlf false');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  run(repo, 'git add -A');
  run(repo, 'git commit -m base');
  worktree = path.join(repo, '.worktrees', 'feature');
  run(repo, `git worktree add "${worktree}" -b feature`);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
});

describe('commitIfDirty', () => {
  it('returns null on a clean tree and commits modified + untracked files otherwise', async () => {
    expect(await worktreeManager.commitIfDirty(worktree, 'noop')).toBeNull();

    fs.writeFileSync(path.join(worktree, 'base.txt'), 'changed\n');
    fs.writeFileSync(path.join(worktree, 'new.txt'), 'new\n');
    const hash = await worktreeManager.commitIfDirty(worktree, 'Auto-commit: test');

    expect(hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(run(worktree, 'git status --porcelain')).toBe('');
    expect(run(repo, 'git show --stat --format=%s feature')).toContain('Auto-commit: test');
    expect(run(repo, 'git show --stat --format= feature')).toContain('new.txt');
  });
});

describe('commitBeforeMerge', () => {
  it('commits when auto-commit is on so the branch carries the leftover work', async () => {
    fs.writeFileSync(path.join(worktree, 'new.txt'), 'new\n');
    const hash = await worktreeManager.commitBeforeMerge(worktree, repo, true);
    expect(hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(run(repo, 'git show --stat --format= feature')).toContain('new.txt');
  });

  it('refuses a dirty worktree when auto-commit is off', async () => {
    fs.writeFileSync(path.join(worktree, 'new.txt'), 'new\n');
    await expect(worktreeManager.commitBeforeMerge(worktree, repo, false)).rejects.toThrow(/uncommitted/i);
    expect(run(worktree, 'git status --porcelain')).toContain('new.txt');
  });

  it('never touches the main checkout or a missing worktree', async () => {
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'dirty\n');
    expect(await worktreeManager.commitBeforeMerge(repo, repo, true)).toBeNull();
    expect(run(repo, 'git status --porcelain')).toContain('dirty.txt');
    expect(await worktreeManager.commitBeforeMerge(path.join(repo, '.worktrees', 'gone'), repo, true)).toBeNull();
    expect(await worktreeManager.commitBeforeMerge(null, repo, true)).toBeNull();
  });
});
