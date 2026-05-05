import { execFile } from 'child_process';
import fs from 'fs';
import nodePath from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SVN_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  // Force UTF-8 output so Korean / CJK / emoji file names survive
  // status/log/diff parsing on Windows. SVN respects LC_ALL/LANG.
  LC_ALL: 'en_US.UTF-8',
  LANG: 'en_US.UTF-8',
};

/**
 * Detect whether `dirPath` is the root of an SVN working copy.
 * Cheap path: a `.svn` directory means it's a working copy (1.7+ layout
 * keeps a single `.svn/` at the working-copy root). Falls back to
 * `svn info` exit code for unusual setups; tolerates `svn` not being on PATH.
 */
export async function isSvnRepository(dirPath: string): Promise<boolean> {
  try {
    const dotSvn = nodePath.join(dirPath, '.svn');
    const stat = await fs.promises.stat(dotSvn).catch(() => null);
    if (stat?.isDirectory()) return true;
  } catch {
    // ignore
  }

  try {
    await execFileAsync('svn', ['info', '--non-interactive', dirPath], {
      env: SVN_ENV,
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export interface SvnRunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run an `svn` subcommand with UTF-8 env and the standard non-interactive
 * flags so credential prompts can't hang the server. Throws on non-zero exit.
 *
 * Caller passes the subcommand args (e.g. ['status', '--xml', dirPath]).
 * `--non-interactive` and `--trust-server-cert-failures=unknown-ca` are
 * appended only when the subcommand is one that contacts a server, to avoid
 * polluting commands like `svn info` against pure local working copies.
 */
export async function runSvn(args: string[], cwd?: string): Promise<SvnRunResult> {
  const finalArgs = ['--non-interactive', ...args];
  const { stdout, stderr } = await execFileAsync('svn', finalArgs, {
    cwd,
    env: SVN_ENV,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout, stderr };
}
