import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

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
      const git = simpleGit(dirPath);
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
      const git = simpleGit(worktreePath);
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
  async createWorktree(projectPath: string, branchName: string): Promise<string> {
    const git = simpleGit(projectPath);

    // Compute worktree directory
    const worktreeBase = path.resolve(projectPath, '.worktrees');
    // Use the part after "feature/" for the directory name, or the whole branch name
    const baseDirName = branchName.replace(/\//g, '-');

    // Ensure the worktrees base directory exists
    if (!fs.existsSync(worktreeBase)) {
      fs.mkdirSync(worktreeBase, { recursive: true });
    }

    // Find a unique directory name (append -2, -3, etc. if already exists)
    let dirName = baseDirName;
    let worktreePath = path.resolve(worktreeBase, dirName);
    let suffix = 1;
    while (fs.existsSync(worktreePath)) {
      suffix++;
      dirName = `${baseDirName}-${suffix}`;
      worktreePath = path.resolve(worktreeBase, dirName);
    }

    // Also deduplicate branch name if directory needed a suffix
    let actualBranch = branchName;
    if (suffix > 1) {
      actualBranch = `${branchName}-${suffix}`;
    }

    // Create a new branch and worktree
    // First, check if the branch already exists
    const branchSummary = await git.branchLocal();
    if (branchSummary.all.includes(actualBranch)) {
      // Branch exists, create worktree using existing branch
      await git.raw(['worktree', 'add', worktreePath, actualBranch]);
    } else {
      // Create new branch with worktree
      await git.raw(['worktree', 'add', '-b', actualBranch, worktreePath]);
    }

    // Auto-install dependencies in the new worktree
    await this.installDependencies(worktreePath);

    return worktreePath;
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
    const git = simpleGit(projectPath);

    try {
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
    } catch {
      // If the worktree directory was already removed, just prune
      await git.raw(['worktree', 'prune']);
    }
  }

  /**
   * Remove a worktree, delete its branch, and clean up the DB record.
   * Returns info about what was cleaned up.
   */
  async cleanupWorktree(projectPath: string, worktreePath: string, branchName: string): Promise<{ worktreeRemoved: boolean; branchDeleted: boolean }> {
    const result = { worktreeRemoved: false, branchDeleted: false };
    const git = simpleGit(projectPath);

    // 1. Remove worktree
    try {
      if (fs.existsSync(worktreePath)) {
        await git.raw(['worktree', 'remove', worktreePath, '--force']);
        result.worktreeRemoved = true;
      } else {
        // Directory already gone, just prune
        await git.raw(['worktree', 'prune']);
        result.worktreeRemoved = true;
      }
    } catch {
      // Fallback: prune stale worktrees
      try {
        await git.raw(['worktree', 'prune']);
        result.worktreeRemoved = true;
      } catch {
        // Ignore
      }
    }

    // 2. Delete the branch
    if (branchName) {
      try {
        await git.raw(['branch', '-D', branchName]);
        result.branchDeleted = true;
      } catch {
        // Branch may already be deleted or not exist
      }
    }

    return result;
  }

  /**
   * Squash merge a source branch into a target worktree's branch.
   * This takes all commits from sourceBranch and applies them as a single commit on the target.
   */
  async squashMergeBranch(targetWorktreePath: string, sourceBranch: string): Promise<void> {
    const git = simpleGit(targetWorktreePath);
    await git.raw(['merge', '--squash', sourceBranch]);
    await git.commit(`Squash merge from ${sourceBranch}`);
  }

  /**
   * List all worktrees for a project.
   */
  async listWorktrees(projectPath: string): Promise<Array<{ path: string; branch: string }>> {
    const git = simpleGit(projectPath);
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
    const git = simpleGit(dirPath);
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
    branches: Array<{ name: string; current: boolean; remote: boolean }>;
    tags: string[];
    stashCount: number;
  }> {
    const git = simpleGit(dirPath);

    const branchResult = await git.branch(['-a']);
    const branches = Object.values(branchResult.branches).map((b) => ({
      name: b.name,
      current: b.current,
      remote: b.name.startsWith('remotes/'),
    }));

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
    const git = simpleGit(dirPath);
    await git.add(files);
  }

  async gitUnstage(dirPath: string, files: string[]): Promise<void> {
    const git = simpleGit(dirPath);
    await git.reset(files.map(f => ['--', f]).flat());
  }

  async gitCommit(dirPath: string, message: string): Promise<string> {
    const git = simpleGit(dirPath);
    const result = await git.commit(message);
    return result.commit;
  }

  async gitPull(dirPath: string, remote = 'origin', branch?: string): Promise<string> {
    const git = simpleGit(dirPath);
    const args = [remote];
    if (branch) args.push(branch);
    const result = await git.pull(args);
    return `${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`;
  }

  async gitPush(dirPath: string, remote = 'origin', branch?: string, setUpstream = false): Promise<string> {
    const git = simpleGit(dirPath);
    const args: string[] = [remote];
    if (branch) args.push(branch);
    if (setUpstream) {
      await git.raw(['push', '-u', ...args]);
    } else {
      await git.push(args);
    }
    return 'ok';
  }

  async gitFetch(dirPath: string, remote = 'origin', prune = false): Promise<void> {
    const git = simpleGit(dirPath);
    const args = ['fetch', remote];
    if (prune) args.push('--prune');
    await git.raw(args);
  }

  async gitCreateBranch(dirPath: string, branchName: string, startPoint?: string): Promise<void> {
    const git = simpleGit(dirPath);
    if (startPoint) {
      await git.checkoutBranch(branchName, startPoint);
    } else {
      await git.checkoutLocalBranch(branchName);
    }
  }

  async gitDeleteBranch(dirPath: string, branchName: string, force = false): Promise<void> {
    const git = simpleGit(dirPath);
    await git.branch([force ? '-D' : '-d', branchName]);
  }

  async gitCheckout(dirPath: string, branchName: string): Promise<void> {
    const git = simpleGit(dirPath);
    await git.checkout(branchName);
  }

  async gitMerge(dirPath: string, sourceBranch: string): Promise<string> {
    const git = simpleGit(dirPath);
    const result = await git.merge([sourceBranch]);
    return result.result ?? 'ok';
  }

  async gitStashPush(dirPath: string, message?: string): Promise<void> {
    const git = simpleGit(dirPath);
    const args = ['stash', 'push'];
    if (message) args.push('-m', message);
    await git.raw(args);
  }

  async gitStashPop(dirPath: string, index = 0): Promise<void> {
    const git = simpleGit(dirPath);
    await git.raw(['stash', 'pop', `stash@{${index}}`]);
  }

  async gitStashList(dirPath: string): Promise<Array<{ index: number; message: string }>> {
    const git = simpleGit(dirPath);
    const result = await git.stashList();
    return result.all.map((s, i) => ({ index: i, message: s.message }));
  }

  async gitDiscard(dirPath: string, files: string[]): Promise<void> {
    const git = simpleGit(dirPath);
    await git.checkout(['--', ...files]);
  }

  async gitDiscardAll(dirPath: string): Promise<void> {
    const git = simpleGit(dirPath);
    await git.checkout(['.']);
    await git.clean('f', ['-d']);
  }

  async gitCreateTag(dirPath: string, tagName: string, message?: string, commit?: string): Promise<void> {
    const git = simpleGit(dirPath);
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
    const git = simpleGit(dirPath);
    await git.raw(['tag', '-d', tagName]);
  }

  async gitDiff(dirPath: string, file?: string, staged = false): Promise<string> {
    const git = simpleGit(dirPath);
    const args: string[] = [];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);
    return await git.diff(args);
  }

  async getGitStatus(dirPath: string): Promise<{
    branch: string;
    tracking: string | null;
    ahead: number;
    behind: number;
    files: Array<{ path: string; index: string; working_dir: string }>;
  }> {
    const git = simpleGit(dirPath);
    const status = await git.status();
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
    };
  }
}

export const worktreeManager = new WorktreeManager();
