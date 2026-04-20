import simpleGit, { SimpleGit } from 'simple-git';

// core.quotePath=false prevents git from C-escaping non-ASCII (e.g. Korean,
// CJK, emoji) filenames in command output like `diff --name-status`.
export function createGit(baseDir: string): SimpleGit {
  return simpleGit(baseDir, { config: ['core.quotePath=false'] });
}
