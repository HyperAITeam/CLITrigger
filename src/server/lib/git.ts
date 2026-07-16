import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';

// core.quotePath=false prevents git from C-escaping non-ASCII (e.g. Korean,
// CJK, emoji) filenames in command output like `diff --name-status`.
export function createGit(baseDir: string, options: Partial<SimpleGitOptions> = {}): SimpleGit {
  return simpleGit(baseDir, { ...options, config: ['core.quotePath=false', ...(options.config ?? [])] });
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
