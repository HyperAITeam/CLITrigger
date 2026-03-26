import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';

export class WorktreeManager {
  /**
   * Sanitize a todo title into a valid branch name.
   * Converts Korean/special chars to a safe slug, prefixed with "feature/".
   */
  sanitizeBranchName(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[가-힣ㄱ-ㅎㅏ-ㅣ]+/g, (match) => {
        // Transliterate Korean to a simple hash-like representation
        return Array.from(match)
          .map((ch) => ch.charCodeAt(0).toString(36))
          .join('');
      })
      .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric except spaces and hyphens
      .replace(/\s+/g, '-')          // spaces to hyphens
      .replace(/-+/g, '-')           // collapse multiple hyphens
      .replace(/^-|-$/g, '')         // trim leading/trailing hyphens
      .slice(0, 50);                 // limit length

    const safeName = slug || `task-${Date.now()}`;
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
   * Create a worktree for a todo item.
   * Worktree path: <projectPath>/../worktrees/<branchName>
   * Returns the absolute worktree path.
   */
  async createWorktree(projectPath: string, branchName: string): Promise<string> {
    const git = simpleGit(projectPath);

    // Compute worktree directory
    const worktreeBase = path.resolve(projectPath, '..', 'worktrees');
    // Use the part after "feature/" for the directory name, or the whole branch name
    const dirName = branchName.replace(/\//g, '-');
    const worktreePath = path.resolve(worktreeBase, dirName);

    // Ensure the worktrees base directory exists
    if (!fs.existsSync(worktreeBase)) {
      fs.mkdirSync(worktreeBase, { recursive: true });
    }

    // Create a new branch and worktree
    // First, check if the branch already exists
    const branchSummary = await git.branchLocal();
    if (branchSummary.all.includes(branchName)) {
      // Branch exists, create worktree using existing branch
      await git.raw(['worktree', 'add', worktreePath, branchName]);
    } else {
      // Create new branch with worktree
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath]);
    }

    return worktreePath;
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
}

export const worktreeManager = new WorktreeManager();
