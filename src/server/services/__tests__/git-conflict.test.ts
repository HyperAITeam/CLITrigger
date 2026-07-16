import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { worktreeManager } from '../worktree-manager.js';

// Integration tests against a real throwaway git repo — the conflict flows
// (detect → resolve → continue/abort) depend on actual gitdir state
// (MERGE_HEAD, rebase-merge) that mocks can't reproduce faithfully.

function run(cwd: string, cmd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Write via fs + `git add -A` so Korean filenames never pass through the
// shell command line (cmd.exe would mangle them); the code under test gets
// paths from simple-git's own status output instead.
function commitFile(dir: string, file: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, file), content);
  run(dir, 'git add -A');
  run(dir, `git commit -m "${message}"`);
}

function setupConflictingBranches(dir: string, file = 'f.txt'): void {
  commitFile(dir, file, 'base\n', 'base');
  run(dir, 'git checkout -b feature');
  commitFile(dir, file, 'feature\n', 'feature change');
  run(dir, 'git checkout main');
  commitFile(dir, file, 'main\n', 'main change');
}

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'clitrigger-git-conflict-'));
  run(repo, 'git init -b main');
  run(repo, 'git config user.name tester');
  run(repo, 'git config user.email tester@example.com');
  run(repo, 'git config commit.gpgsign false');
  run(repo, 'git config core.autocrlf false');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
});

describe('gitMerge conflict flow', () => {
  it('detects a conflict, reports the files, and exposes mergeInProgress', async () => {
    setupConflictingBranches(repo);
    const result = await worktreeManager.gitMerge(repo, 'feature');
    expect(result.conflict).toBe(true);
    expect(result.conflictFiles).toEqual(['f.txt']);

    const status = await worktreeManager.getGitStatus(repo);
    expect(status.mergeInProgress).toBe(true);
    expect(status.rebaseInProgress).toBe(false);
    expect(status.conflicted).toEqual(['f.txt']);
  });

  it('resolve(ours) then continue produces a merge commit keeping our content', async () => {
    setupConflictingBranches(repo);
    await worktreeManager.gitMerge(repo, 'feature');

    await worktreeManager.gitResolveConflict(repo, 'f.txt', 'ours');
    const afterResolve = await worktreeManager.getGitStatus(repo);
    expect(afterResolve.conflicted).toEqual([]);

    const cont = await worktreeManager.gitConflictContinue(repo);
    expect(cont.conflict).toBe(false);

    const after = await worktreeManager.getGitStatus(repo);
    expect(after.mergeInProgress).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf-8')).toBe('main\n');
    // Merge commit has two parents.
    expect(run(repo, 'git rev-list --parents -1 HEAD').trim().split(' ')).toHaveLength(3);
  });

  it('abort restores the pre-merge state', async () => {
    setupConflictingBranches(repo);
    await worktreeManager.gitMerge(repo, 'feature');

    await worktreeManager.gitConflictAbort(repo);
    const status = await worktreeManager.getGitStatus(repo);
    expect(status.mergeInProgress).toBe(false);
    expect(status.conflicted).toEqual([]);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf-8')).toBe('main\n');
  });

  it('re-throws non-conflict errors (no in-progress op left behind)', async () => {
    commitFile(repo, 'f.txt', 'base\n', 'base');
    await expect(worktreeManager.gitMerge(repo, 'no-such-branch')).rejects.toThrow();
    const status = await worktreeManager.getGitStatus(repo);
    expect(status.mergeInProgress).toBe(false);
  });

  it('handles Korean filenames unescaped (core.quotePath=false)', async () => {
    setupConflictingBranches(repo, '한글파일.txt');
    const result = await worktreeManager.gitMerge(repo, 'feature');
    expect(result.conflict).toBe(true);
    expect(result.conflictFiles).toEqual(['한글파일.txt']);

    await worktreeManager.gitResolveConflict(repo, '한글파일.txt', 'theirs');
    const cont = await worktreeManager.gitConflictContinue(repo);
    expect(cont.conflict).toBe(false);
    expect(fs.readFileSync(path.join(repo, '한글파일.txt'), 'utf-8')).toBe('feature\n');
  });
});

describe('gitRebase conflict flow', () => {
  it('detects a conflict, resolve(theirs) + continue completes the rebase', async () => {
    setupConflictingBranches(repo);
    run(repo, 'git checkout feature');

    const result = await worktreeManager.gitRebase(repo, 'main');
    expect(result.conflict).toBe(true);
    expect(result.conflictFiles).toEqual(['f.txt']);

    const during = await worktreeManager.getGitStatus(repo);
    expect(during.rebaseInProgress).toBe(true);

    // During a rebase "theirs" is the commit being replayed (feature's change).
    await worktreeManager.gitResolveConflict(repo, 'f.txt', 'theirs');
    const cont = await worktreeManager.gitConflictContinue(repo);
    expect(cont.conflict).toBe(false);

    const after = await worktreeManager.getGitStatus(repo);
    expect(after.rebaseInProgress).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf-8')).toBe('feature\n');
  });

  it('abort restores the pre-rebase branch state', async () => {
    setupConflictingBranches(repo);
    run(repo, 'git checkout feature');
    await worktreeManager.gitRebase(repo, 'main');

    await worktreeManager.gitConflictAbort(repo);
    const status = await worktreeManager.getGitStatus(repo);
    expect(status.rebaseInProgress).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf-8')).toBe('feature\n');
  });
});

describe('gitConflictContinue/Abort guards', () => {
  it('throw when no merge or rebase is in progress', async () => {
    commitFile(repo, 'f.txt', 'base\n', 'base');
    await expect(worktreeManager.gitConflictContinue(repo)).rejects.toThrow('No merge or rebase in progress');
    await expect(worktreeManager.gitConflictAbort(repo)).rejects.toThrow('No merge or rebase in progress');
  });
});
