import { createGit } from '../lib/git.js';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

export interface PushBranchSpec {
  local: string;
  remote: string;
  setUpstream: boolean;
}

export interface GitPushOptions {
  remote?: string;
  branches?: PushBranchSpec[];
  pushAllTags?: boolean;
  force?: boolean;
}

export class WorktreeManager {
  /**
   * Sanitize a todo title into a valid branch name.
   * Converts Korean/special chars to a safe slug, prefixed with "feature/".
   */
  sanitizeBranchName(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric (Korean, etc.) except spaces and hyphens
      .replace(/\s+/g, '-')          // spaces to hyphens
      .replace(/-+/g, '-')           // collapse multiple hyphens
      .replace(/^-|-$/g, '')         // trim leading/trailing hyphens
      .slice(0, 40);                 // limit length

    // If slug is too short (e.g. Korean-only title), use a short random ID
    const safeName = slug.length >= 3
      ? slug
      : `task-${Math.random().toString(36).substring(2, 8)}`;
    return `feature/${safeName}`;
  }

  /**
   * Check if a directory is inside a git repository.
   */
  async isGitRepository(dirPath: string): Promise<boolean> {
    try {
      const git = createGit(dirPath);
      return await git.checkIsRepo();
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory is a valid git worktree (has .git file and can run git status).
   */
  async isValidWorktree(worktreePath: string): Promise<boolean> {
    try {
      const gitPath = path.join(worktreePath, '.git');
      if (!fs.existsSync(gitPath)) return false;
      const git = createGit(worktreePath);
      await git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a worktree for a todo item.
   * Worktree path: <projectPath>/../worktrees/<branchName>
   * Returns the absolute worktree path.
   */
  /**
   * Ensure an entry exists in the project's .gitignore.
   * Appends the entry if not already present.
   */
  private ensureGitignore(projectPath: string, entry: string): void {
    const gitignorePath = path.join(projectPath, '.gitignore');
    try {
      const content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
      const lines = content.split(/\r?\n/);
      if (!lines.some(l => l.trim() === entry)) {
        const newline = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(gitignorePath, `${newline}${entry}\n`);
      }
    } catch {
      // Non-fatal: .gitignore update failure shouldn't block operations
    }
  }

  async createWorktree(projectPath: string, branchName: string, autoInstall = false): Promise<{ worktreePath: string; branchName: string }> {
    const git = createGit(projectPath);

    // Compute worktree directory
    const worktreeBase = path.resolve(projectPath, '.worktrees');
    // Use the part after "feature/" for the directory name, or the whole branch name
    const baseDirName = branchName.replace(/\//g, '-');

    // Ensure the worktrees base directory exists
    if (!fs.existsSync(worktreeBase)) {
      fs.mkdirSync(worktreeBase, { recursive: true });
    }

    // Ensure .worktrees is in .gitignore
    this.ensureGitignore(projectPath, '.worktrees');

    // Find a unique directory name AND branch name. Bump the suffix until
    // neither the worktree dir nor the branch exists. This prevents a new
    // session from silently reusing a leftover branch when a prior cleanup
    // removed the directory but failed to delete the branch.
    const branchSummary = await git.branchLocal();
    const branchExists = (name: string) => branchSummary.all.includes(name);

    let dirName = baseDirName;
    let worktreePath = path.resolve(worktreeBase, dirName);
    let actualBranch = branchName;
    let suffix = 1;
    while (fs.existsSync(worktreePath) || branchExists(actualBranch)) {
      suffix++;
      dirName = `${baseDirName}-${suffix}`;
      worktreePath = path.resolve(worktreeBase, dirName);
      actualBranch = `${branchName}-${suffix}`;
    }

    // actualBranch is guaranteed unique now — always create a fresh branch.
    await git.raw(['worktree', 'add', '-b', actualBranch, worktreePath]);

    // Auto-install dependencies in the background (non-blocking).
    // Opt-in per project (npm_auto_install) — the worktree flow itself is language-agnostic,
    // so npm-specific convenience must be explicitly enabled.
    if (autoInstall) {
      this.installDependencies(worktreePath).catch((err) => {
        console.warn(`[worktree] dependency install failed:`, err);
      });
    }

    return { worktreePath, branchName: actualBranch };
  }

  /**
   * Install npm dependencies in a worktree (root + client).
   * Failures are logged but do not block worktree creation.
   */
  private async installDependencies(worktreePath: string): Promise<void> {
    // Root-level dependencies
    if (fs.existsSync(path.join(worktreePath, 'package.json'))) {
      try {
        execSync('npm install', { cwd: worktreePath, stdio: 'ignore', timeout: 120_000 });
      } catch (err) {
        console.warn(`[worktree] npm install failed at root: ${(err as Error).message}`);
      }
    }

    // Client-level dependencies (monorepo sub-package)
    const clientDir = path.join(worktreePath, 'src', 'client');
    if (fs.existsSync(path.join(clientDir, 'package.json'))) {
      try {
        execSync('npm install', { cwd: clientDir, stdio: 'ignore', timeout: 120_000 });
      } catch (err) {
        console.warn(`[worktree] npm install failed at src/client: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Remove a worktree and prune.
   */
  async removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
    const git = createGit(projectPath);

    try {
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
    } catch {
      // If the worktree directory was already removed, just prune
      await git.raw(['worktree', 'prune']);
    }
  }

  /**
   * Remove a worktree, delete its branch, and clean up the DB record.
   * Reports per-step success/failure so callers can avoid optimistic UI
   * clears when git refused (e.g. branch still checked out in a stale
   * worktree dir locked by a process on Windows).
   */
  async cleanupWorktree(projectPath: string, worktreePath: string, branchName: string, deleteBranch = true): Promise<{
    worktreeRemoved: boolean;
    branchDeleted: boolean;
    worktreeError?: string;
    branchError?: string;
  }> {
    const result: { worktreeRemoved: boolean; branchDeleted: boolean; worktreeError?: string; branchError?: string } = {
      worktreeRemoved: false,
      branchDeleted: false,
    };
    // Safety: runs without isolation store worktreePath === projectPath. The main
    // working tree is not a removable worktree — `worktree remove --force` would fail
    // and the rmSync fallback below would delete the whole project. Refuse outright.
    if (worktreePath && path.resolve(worktreePath) === path.resolve(projectPath)) {
      return result;
    }

    const git = createGit(projectPath);

    // 1. Remove worktree. `worktree remove --force` does both the admin entry
    // and the directory; if that fails (locked file on Windows is common),
    // try harder: rmSync the directory ourselves, then prune the admin entry.
    const dirExisted = !!worktreePath && fs.existsSync(worktreePath);
    if (worktreePath && dirExisted) {
      try {
        await git.raw(['worktree', 'remove', worktreePath, '--force']);
      } catch (err) {
        result.worktreeError = err instanceof Error ? err.message : String(err);
        // Fallback: nuke the directory + prune admin entry.
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch (rmErr) {
          result.worktreeError = `${result.worktreeError}; rm fallback failed: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`;
        }
        try {
          await git.raw(['worktree', 'prune']);
        } catch {
          // prune is best-effort; the rmSync above is the load-bearing step
        }
      }
    } else {
      // Directory wasn't there to begin with — just prune any stale admin entry
      try {
        await git.raw(['worktree', 'prune']);
      } catch {
        // ignore — nothing to prune
      }
    }
    // Final check: directory gone == worktree gone from git's perspective too
    result.worktreeRemoved = !worktreePath || !fs.existsSync(worktreePath);
    if (result.worktreeRemoved) {
      // success — clear any earlier transient error
      result.worktreeError = undefined;
    }

    // 2. Delete the branch (only if requested). If the worktree admin entry
    // is still pinning the branch, `branch -D` errors with "checked out at" —
    // try one more prune then retry, then surface the error.
    if (deleteBranch && branchName) {
      const tryDelete = async () => git.raw(['branch', '-D', branchName]);
      try {
        await tryDelete();
        result.branchDeleted = true;
      } catch (err) {
        try {
          await git.raw(['worktree', 'prune']);
          await tryDelete();
          result.branchDeleted = true;
        } catch (err2) {
          result.branchError = err2 instanceof Error ? err2.message : String(err2);
          // Original error often more useful — keep both
          const firstMsg = err instanceof Error ? err.message : String(err);
          if (firstMsg && firstMsg !== result.branchError) {
            result.branchError = `${firstMsg} (retry: ${result.branchError})`;
          }
        }
      }
    }

    return result;
  }

  /**
   * Squash merge a source branch into a target worktree's branch.
   * This takes all commits from sourceBranch and applies them as a single commit on the target.
   */
  async squashMergeBranch(targetWorktreePath: string, sourceBranch: string): Promise<void> {
    const git = createGit(targetWorktreePath);
    try {
      await git.raw(['merge', '--squash', sourceBranch]);
      await git.commit(`Squash merge from ${sourceBranch}`);
    } catch (err) {
      // Abort merge to avoid leaving worktree in dirty state
      try { await git.raw(['merge', '--abort']); } catch { /* may not be in merge state */ }
      throw err;
    }
  }

  /**
   * List all worktrees for a project.
   */
  async listWorktrees(projectPath: string): Promise<Array<{ path: string; branch: string }>> {
    const git = createGit(projectPath);
    const result = await git.raw(['worktree', 'list', '--porcelain']);

    const worktrees: Array<{ path: string; branch: string }> = [];
    const entries = result.split('\n\n').filter(Boolean);

    for (const entry of entries) {
      const lines = entry.split('\n');
      let wtPath = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.substring('worktree '.length);
        }
        if (line.startsWith('branch ')) {
          branch = line.substring('branch '.length).replace('refs/heads/', '');
        }
      }

      if (wtPath && branch) {
        worktrees.push({ path: wtPath, branch });
      }
    }

    return worktrees;
  }

  /**
   * Get git status for a directory (repo or worktree).
   * Returns branch info and file statuses.
   */
  /**
   * Get git log (commit history) for a directory.
   */
  async getGitLog(dirPath: string, options: { skip?: number; limit?: number } = {}): Promise<{
    commits: Array<{
      hash: string;
      parentHashes: string[];
      refs: string[];
      message: string;
      author: string;
      date: string;
    }>;
    hasMore: boolean;
  }> {
    const skip = options.skip ?? 0;
    const limit = options.limit ?? 50;
    const git = createGit(dirPath);
    const raw = await git.raw([
      'log', '--all', '--topo-order',
      `--format=%H%x1E%P%x1E%D%x1E%s%x1E%an%x1E%aI`,
      `--max-count=${limit + 1}`,
      `--skip=${skip}`,
    ]);

    const lines = raw.trim().split('\n').filter(Boolean);
    const hasMore = lines.length > limit;
    const entries = hasMore ? lines.slice(0, limit) : lines;

    const commits = entries.map((line) => {
      const [hash, parents, refsStr, message, author, date] = line.split('\x1E');
      return {
        hash,
        parentHashes: parents ? parents.split(' ').filter(Boolean) : [],
        refs: refsStr ? refsStr.split(', ').filter(Boolean) : [],
        message,
        author,
        date,
      };
    });

    return { commits, hasMore };
  }

  /**
   * Get git refs (branches, tags, stash count) for a directory.
   */
  async getGitRefs(dirPath: string): Promise<{
    branches: Array<{ name: string; current: boolean; remote: boolean; upstream?: string | null; ahead?: number; behind?: number }>;
    tags: string[];
    stashCount: number;
  }> {
    const git = createGit(dirPath);

    // Per-local-branch upstream tracking + ahead/behind in one cheap call.
    // %(upstream:track) yields e.g. "[ahead 2, behind 1]", "[ahead 2]",
    // "[behind 1]", "[gone]" or "". refs/heads lists local branches only, so
    // remote-tracking refs (remotes/*) get no tracking info (correct).
    const trackByName = new Map<string, { upstream: string | null; ahead: number; behind: number }>();
    try {
      const raw = await git.raw([
        'for-each-ref',
        '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)',
        'refs/heads',
      ]);
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const [name, upstream, track = ''] = line.split('\t');
        const aheadMatch = /ahead (\d+)/.exec(track);
        const behindMatch = /behind (\d+)/.exec(track);
        trackByName.set(name, {
          upstream: upstream || null,
          ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
          behind: behindMatch ? Number(behindMatch[1]) : 0,
        });
      }
    } catch {
      // for-each-ref unsupported or detached HEAD — branches still returned
      // without tracking info.
    }

    const branchResult = await git.branch(['-a']);
    const branches = Object.values(branchResult.branches).map((b) => {
      const track = trackByName.get(b.name);
      return {
        name: b.name,
        current: b.current,
        remote: b.name.startsWith('remotes/'),
        upstream: track ? track.upstream : null,
        ahead: track ? track.ahead : 0,
        behind: track ? track.behind : 0,
      };
    });

    const tagResult = await git.tags();
    const tags = tagResult.all;

    let stashCount = 0;
    try {
      const stashResult = await git.stashList();
      stashCount = stashResult.total;
    } catch {
      // No stash support or empty
    }

    return { branches, tags, stashCount };
  }

  // --- Git action methods ---

  async gitStage(dirPath: string, files: string[]): Promise<void> {
    const git = createGit(dirPath);
    await git.add(files);
  }

  async gitUnstage(dirPath: string, files: string[]): Promise<void> {
    const git = createGit(dirPath);
    await git.reset(['--', ...files]);
  }

  async gitCommit(dirPath: string, message: string): Promise<string> {
    const git = createGit(dirPath);
    const result = await git.commit(message);
    return result.commit;
  }

  async gitPull(dirPath: string, remote = 'origin', branch?: string): Promise<string> {
    const git = createGit(dirPath);
    const result = await git.pull(remote, branch);
    return `${result.summary?.changes ?? 0} changes, ${result.summary?.insertions ?? 0} insertions, ${result.summary?.deletions ?? 0} deletions`;
  }

  async gitPush(dirPath: string, opts: GitPushOptions = {}): Promise<string> {
    const git = createGit(dirPath);
    const remote = opts.remote || 'origin';
    const pushAllTags = opts.pushAllTags === true;
    const force = opts.force === true;
    const branches = (opts.branches || []).filter((b) => b && b.local);

    const flags: string[] = [];
    if (force) flags.push('--force-with-lease');
    if (pushAllTags) flags.push('--tags');

    if (branches.length === 0) {
      await git.raw(['push', remote, ...flags]);
      return 'ok';
    }

    const upstream = branches.filter((b) => b.setUpstream);
    const plain = branches.filter((b) => !b.setUpstream);
    const refspec = (b: PushBranchSpec) => {
      const dst = (b.remote || '').trim() || b.local;
      return `${b.local}:${dst}`;
    };

    if (plain.length > 0) {
      await git.raw(['push', remote, ...flags, ...plain.map(refspec)]);
    }
    if (upstream.length > 0) {
      // --tags is invalid in some git versions when combined with -u + refspecs;
      // applying tags only on the first call is enough since tags are repo-wide.
      const upstreamFlags = flags.filter((f) => f !== '--tags' || plain.length === 0);
      await git.raw(['push', '-u', remote, ...upstreamFlags, ...upstream.map(refspec)]);
    }
    return 'ok';
  }

  async getRemotes(dirPath: string): Promise<Array<{ name: string; url: string }>> {
    const git = createGit(dirPath);
    const remotes = await git.getRemotes(true);
    return remotes.map((r) => ({
      name: r.name,
      url: r.refs?.push || r.refs?.fetch || '',
    }));
  }

  async gitFetch(dirPath: string, remote = 'origin', prune = false): Promise<void> {
    const git = createGit(dirPath);
    const args = ['fetch', remote];
    if (prune) args.push('--prune');
    await git.raw(args);
  }

  async gitCreateBranch(dirPath: string, branchName: string, startPoint?: string): Promise<void> {
    const git = createGit(dirPath);
    if (startPoint) {
      await git.checkoutBranch(branchName, startPoint);
    } else {
      await git.checkoutLocalBranch(branchName);
    }
  }

  async gitDeleteBranch(dirPath: string, branchName: string, force = false): Promise<void> {
    const git = createGit(dirPath);
    await git.branch([force ? '-D' : '-d', branchName]);
  }

  async gitCheckout(dirPath: string, branchName: string): Promise<void> {
    const git = createGit(dirPath);
    await git.checkout(branchName);
  }

  /**
   * Detect an in-progress merge/rebase by looking at the repository's actual
   * gitdir. `rev-parse --git-dir` resolves the per-worktree gitdir
   * (.git/worktrees/<x>) where MERGE_HEAD really lives, and may return a
   * relative path — resolve against dirPath.
   */
  private async getGitOpState(dirPath: string): Promise<{ merging: boolean; rebasing: boolean }> {
    const git = createGit(dirPath);
    const gitDir = path.resolve(dirPath, (await git.raw(['rev-parse', '--git-dir'])).trim());
    return {
      merging: fs.existsSync(path.join(gitDir, 'MERGE_HEAD')),
      rebasing: fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply')),
    };
  }

  /**
   * Distinguish "conflict left the repo in an in-progress op" from a plain
   * failure by repository state, not error-message parsing: errors like
   * "local changes would be overwritten" make git clean up after itself and
   * leave no MERGE_HEAD, so they re-throw as regular errors.
   */
  async gitMerge(dirPath: string, sourceBranch: string): Promise<{ result: string; conflict: boolean; conflictFiles: string[] }> {
    const git = createGit(dirPath);
    try {
      const result = await git.merge([sourceBranch]);
      return { result: result.result ?? 'ok', conflict: false, conflictFiles: [] };
    } catch (err) {
      const { merging } = await this.getGitOpState(dirPath);
      if (!merging) throw err;
      const status = await git.status();
      return { result: 'conflict', conflict: true, conflictFiles: status.conflicted };
    }
  }

  /**
   * Resolve one conflicted file by taking a whole side. When the chosen side
   * deleted the file (DU/UD conflicts have no stage 2 or 3 entry),
   * `checkout --ours/--theirs` fails — accept the deletion via `git rm`.
   */
  async gitResolveConflict(dirPath: string, file: string, side: 'ours' | 'theirs'): Promise<void> {
    const git = createGit(dirPath);
    const stages = await git.raw(['ls-files', '-u', '--', file]);
    if (!stages.trim()) throw new Error(`Not a conflicted file: ${file}`);
    const wantStage = side === 'ours' ? 2 : 3;
    const hasSide = stages.split('\n').some((line) => {
      const fields = line.split(/\s+/);
      return fields.length >= 3 && Number(fields[2]) === wantStage;
    });
    if (hasSide) {
      await git.raw(['checkout', side === 'ours' ? '--ours' : '--theirs', '--', file]);
      await git.raw(['add', '--', file]);
    } else {
      await git.raw(['rm', '-f', '--', file]);
    }
  }

  // Reject a file path that escapes the repo root (traversal guard for the
  // manual conflict-resolver's read/write endpoints).
  private resolveInsideRepo(dirPath: string, file: string): string {
    const root = path.resolve(dirPath);
    const abs = path.resolve(root, file);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Invalid file path');
    return abs;
  }

  // Raw working-tree content of a conflicted file (still contains the
  // <<<<<<< / ======= / >>>>>>> markers) for the hunk-picker UI.
  async readConflictFile(dirPath: string, file: string): Promise<string> {
    return fs.promises.readFile(this.resolveInsideRepo(dirPath, file), 'utf8');
  }

  // Write the user's resolved content back and stage it, concluding the file's
  // conflict. The overall merge/rebase is finalized separately (commit / continue).
  async resolveConflictWithContent(dirPath: string, file: string, content: string): Promise<void> {
    await fs.promises.writeFile(this.resolveInsideRepo(dirPath, file), content, 'utf8');
    await createGit(dirPath).raw(['add', '--', file]);
  }

  /**
   * Conclude an in-progress merge/rebase. Merge uses `commit --no-edit`
   * (keeps MERGE_MSG, never opens an editor); rebase blocks the editor via
   * `-c core.editor=true`. A rebase may hit a new conflict on the next commit —
   * that returns { conflict: true } in the same shape as gitMerge.
   *
   * Not done via `.env({ ...process.env, GIT_EDITOR: 'true' })`: simple-git
   * >=3.34 audits every env var passed through `.env()` and rejects any risky
   * key the host machine happens to export (EDITOR, SSH_ASKPASS, GIT_PAGER, …).
   * core.editor loses only to an explicitly exported GIT_EDITOR, which a server
   * process realistically never has.
   */
  async gitConflictContinue(dirPath: string): Promise<{ conflict: boolean; conflictFiles: string[] }> {
    const { merging, rebasing } = await this.getGitOpState(dirPath);
    const git = createGit(dirPath, {
      config: ['core.editor=true'],
      unsafe: { allowUnsafeEditor: true },
    });
    if (merging) {
      await git.raw(['commit', '--no-edit']);
      return { conflict: false, conflictFiles: [] };
    }
    if (rebasing) {
      try {
        await git.raw(['rebase', '--continue']);
        return { conflict: false, conflictFiles: [] };
      } catch (err) {
        const after = await this.getGitOpState(dirPath);
        if (!after.rebasing) throw err;
        const status = await createGit(dirPath).status();
        if (status.conflicted.length === 0) throw err;
        return { conflict: true, conflictFiles: status.conflicted };
      }
    }
    throw new Error('No merge or rebase in progress');
  }

  async gitConflictAbort(dirPath: string): Promise<void> {
    const { merging, rebasing } = await this.getGitOpState(dirPath);
    const git = createGit(dirPath);
    if (merging) await git.raw(['merge', '--abort']);
    else if (rebasing) await git.raw(['rebase', '--abort']);
    else throw new Error('No merge or rebase in progress');
  }

  async gitStashPush(dirPath: string, message?: string): Promise<void> {
    const git = createGit(dirPath);
    const args = ['stash', 'push'];
    if (message) args.push('-m', message);
    await git.raw(args);
  }

  async gitStashPop(dirPath: string, index = 0): Promise<void> {
    const git = createGit(dirPath);
    await git.raw(['stash', 'pop', `stash@{${index}}`]);
  }

  async gitStashList(dirPath: string): Promise<Array<{ index: number; message: string }>> {
    const git = createGit(dirPath);
    const result = await git.stashList();
    return result.all.map((s, i) => ({ index: i, message: s.message }));
  }

  async gitDiscard(dirPath: string, files: string[]): Promise<void> {
    const git = createGit(dirPath);
    await git.checkout(['--', ...files]);
  }

  async gitDiscardAll(dirPath: string): Promise<void> {
    const git = createGit(dirPath);
    await git.checkout(['.']);
    await git.clean('f', ['-d']);
  }

  async gitCreateTag(dirPath: string, tagName: string, message?: string, commit?: string): Promise<void> {
    const git = createGit(dirPath);
    const args = ['tag'];
    if (message) {
      args.push('-a', tagName, '-m', message);
    } else {
      args.push(tagName);
    }
    if (commit) args.push(commit);
    await git.raw(args);
  }

  async gitDeleteTag(dirPath: string, tagName: string): Promise<void> {
    const git = createGit(dirPath);
    await git.raw(['tag', '-d', tagName]);
  }

  async gitRenameBranch(dirPath: string, oldName: string, newName: string): Promise<void> {
    const git = createGit(dirPath);
    await git.branch(['-m', oldName, newName]);
  }

  async gitRebase(dirPath: string, onto: string): Promise<{ result: string; conflict: boolean; conflictFiles: string[] }> {
    const git = createGit(dirPath);
    try {
      const result = await git.rebase([onto]);
      return { result: typeof result === 'string' ? result : 'ok', conflict: false, conflictFiles: [] };
    } catch (err) {
      const { rebasing } = await this.getGitOpState(dirPath);
      if (!rebasing) throw err;
      const status = await git.status();
      return { result: 'conflict', conflict: true, conflictFiles: status.conflicted };
    }
  }

  // Revert / cherry-pick can leave conflicts. We don't add a bespoke
  // continue/abort UI: the conflict banner keys off `git status` conflicted
  // files (not merge/rebase state), so resolving in the file view + committing
  // finalizes the revert/cherry-pick.
  // ponytail: no REVERT_HEAD/CHERRY_PICK_HEAD abort button; resolve-and-commit
  // covers it. Add a sequencer abort if users hit dead ends.
  async gitRevert(dirPath: string, commit: string): Promise<{ conflict: boolean; conflictFiles: string[] }> {
    const git = createGit(dirPath);
    try {
      await git.raw(['revert', '--no-edit', commit]);
      return { conflict: false, conflictFiles: [] };
    } catch (err) {
      const status = await git.status();
      if (status.conflicted.length === 0) throw err;
      return { conflict: true, conflictFiles: status.conflicted };
    }
  }

  async gitCherryPick(dirPath: string, commit: string): Promise<{ conflict: boolean; conflictFiles: string[] }> {
    const git = createGit(dirPath);
    try {
      await git.raw(['cherry-pick', commit]);
      return { conflict: false, conflictFiles: [] };
    } catch (err) {
      const status = await git.status();
      if (status.conflicted.length === 0) throw err;
      return { conflict: true, conflictFiles: status.conflicted };
    }
  }

  async gitReset(dirPath: string, commit: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    const git = createGit(dirPath);
    await git.raw(['reset', `--${mode}`, commit]);
  }

  async gitDiff(dirPath: string, file?: string, staged = false): Promise<string> {
    const git = createGit(dirPath);
    const args: string[] = [];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);
    return await git.diff(args);
  }

  async getCommitFiles(dirPath: string, commitHash: string): Promise<Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
    oldPath?: string;
  }>> {
    if (!/^[0-9a-f]{4,40}$/i.test(commitHash)) {
      throw new Error('Invalid commit hash');
    }
    const git = createGit(dirPath);

    // Check if root commit (no parents)
    let isRoot = false;
    try {
      await git.raw(['rev-parse', `${commitHash}^`]);
    } catch {
      isRoot = true;
    }

    const rootFlag = isRoot ? ['--root'] : [];

    // Get name-status (status + path)
    const nameStatusRaw = await git.raw([
      'diff-tree', '-r', '--no-commit-id', ...rootFlag, '--name-status', commitHash,
    ]);
    // Get numstat (additions/deletions)
    const numstatRaw = await git.raw([
      'diff-tree', '-r', '--no-commit-id', ...rootFlag, '--numstat', commitHash,
    ]);

    // Parse name-status: "M\tpath" or "R100\toldPath\tnewPath"
    const statusMap = new Map<string, { status: string; oldPath?: string }>();
    for (const line of nameStatusRaw.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const statusCode = parts[0].charAt(0); // R100 → R
      if (statusCode === 'R' || statusCode === 'C') {
        statusMap.set(parts[2], { status: statusCode, oldPath: parts[1] });
      } else {
        statusMap.set(parts[1], { status: statusCode });
      }
    }

    // Parse numstat: "10\t5\tpath" or "10\t5\t{old => new}" for renames
    const statMap = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstatRaw.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
      // For renames, numstat shows the new path
      statMap.set(parts[2], { additions, deletions });
    }

    // Combine
    const files: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
      oldPath?: string;
    }> = [];

    for (const [filePath, info] of statusMap) {
      const stats = statMap.get(filePath) ?? { additions: 0, deletions: 0 };
      files.push({
        path: filePath,
        status: info.status,
        additions: stats.additions,
        deletions: stats.deletions,
        ...(info.oldPath ? { oldPath: info.oldPath } : {}),
      });
    }

    return files;
  }

  async getCommitDiff(dirPath: string, commitHash: string, file?: string): Promise<string> {
    if (!/^[0-9a-f]{4,40}$/i.test(commitHash)) {
      throw new Error('Invalid commit hash');
    }
    const git = createGit(dirPath);

    // Check if merge commit (multiple parents)
    let parentCount = 0;
    let firstParent = '';
    try {
      const parentsRaw = await git.raw(['rev-parse', `${commitHash}^@`]);
      const parents = parentsRaw.trim().split('\n').filter(Boolean);
      parentCount = parents.length;
      firstParent = parents[0] ?? '';
    } catch {
      // Root commit — no parents
    }

    if (parentCount >= 2 && firstParent) {
      // Merge commit: diff against first parent
      const args = ['diff', firstParent, commitHash];
      if (file) args.push('--', file);
      return await git.raw(args);
    }

    // Regular or root commit: git show
    const args = ['show', '--format=', '-p', commitHash];
    if (file) args.push('--', file);
    return await git.raw(args);
  }

  async getGitStatus(dirPath: string): Promise<{
    branch: string;
    tracking: string | null;
    ahead: number;
    behind: number;
    files: Array<{ path: string; index: string; working_dir: string }>;
    conflicted: string[];
    mergeInProgress: boolean;
    rebaseInProgress: boolean;
  }> {
    const git = createGit(dirPath);
    const status = await git.status();
    const op = await this.getGitOpState(dirPath);
    return {
      branch: status.current ?? '',
      tracking: status.tracking ?? null,
      ahead: status.ahead,
      behind: status.behind,
      files: status.files.map((f) => ({
        path: f.path,
        index: f.index ?? ' ',
        working_dir: f.working_dir ?? ' ',
      })),
      conflicted: status.conflicted,
      mergeInProgress: op.merging,
      rebaseInProgress: op.rebasing,
    };
  }
}

export const worktreeManager = new WorktreeManager();
