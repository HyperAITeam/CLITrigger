import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import { isWslPath } from '../utils/wsl.js';

// core.quotePath=false prevents git from C-escaping non-ASCII (e.g. Korean,
// CJK, emoji) filenames in command output like `diff --name-status`.
export function createGit(baseDir: string, options: Partial<SimpleGitOptions> = {}): SimpleGit {
  // WSL repos must be driven by the distro's own git: git-for-Windows refuses
  // them over UNC ("detected dubious ownership") and would write Windows-form
  // gitdir paths that the CLI running inside WSL cannot resolve. wsl.exe picks
  // up both the distro and the working directory from the UNC cwd simple-git
  // spawns with, so the binary tuple alone is enough.
  const binary: Partial<SimpleGitOptions> = isWslPath(baseDir)
    ? { binary: ['wsl.exe', 'git'] }
    : {};
  return simpleGit(baseDir, { ...binary, ...options, config: ['core.quotePath=false', ...(options.config ?? [])] });
}

export async function resolveLocalBaseBranch(git: SimpleGit, configured: string): Promise<string | null> {
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes(configured)) return configured;
    return branches.all.find((b) => b === 'master' || b === 'main') ?? null;
  } catch {
    return null;
  }
}
