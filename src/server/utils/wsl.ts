import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * WSL projects are stored with their UNC path (\\wsl.localhost\<distro>\...) so
 * every fs/scanner/editor call keeps working natively on Windows. The UNC form
 * encodes both the distro and the Linux path, so no extra DB column is needed —
 * everything WSL-specific is derived from the path itself.
 */
export interface WslLocation {
  distro: string;
  /** POSIX path inside the distro, e.g. /home/sylvain/git/personal/evsuite */
  linuxPath: string;
  /** UNC path usable from Windows, e.g. \\wsl.localhost\Ubuntu\home\... */
  uncPath: string;
}

// Matches both the modern \\wsl.localhost\ and the legacy \\wsl$\ prefixes.
const WSL_UNC_RE = /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i;

export function isWslPath(p: string | undefined | null): boolean {
  return !!p && WSL_UNC_RE.test(p);
}

export function parseWslPath(p: string): WslLocation | null {
  const m = WSL_UNC_RE.exec(p);
  if (!m) return null;
  const distro = m[1];
  const rest = (m[2] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  return { distro, linuxPath: `/${rest}`, uncPath: toUncPath(distro, `/${rest}`) };
}

export function toUncPath(distro: string, linuxPath: string): string {
  const rel = linuxPath.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distro}${rel ? `\\${rel}` : ''}`;
}

/**
 * The path as the spawned agent sees it. For a WSL project the CLI runs inside
 * the distro and only knows the Linux path — handing it the UNC path makes
 * sandbox permission globs match nothing, silently rejecting every Edit/Write.
 * Otherwise just normalize separators: Claude's permission matcher folds paths
 * to forward slashes, and mixed separators fail to match on Windows.
 */
export function agentVisiblePath(p: string): string {
  return parseWslPath(p)?.linuxPath ?? p.replace(/\\/g, '/');
}

/** Installed distro names, in `wsl.exe -l -q` order (first is the default). */
export async function listWslDistros(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  try {
    // wsl.exe emits UTF-16LE unless WSL_UTF8 is set.
    const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], {
      env: { ...process.env, WSL_UTF8: '1' },
      timeout: 10_000,
    });
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface WslCliProbe {
  found: boolean;
  /** Resolved path reported by `command -v` inside the distro. */
  path?: string;
  /**
   * True when the command only resolved through WSL's Windows PATH interop
   * (/mnt/c/...). Such a binary is a Windows executable and would receive Linux
   * paths it cannot understand — treat it as not installed.
   */
  windowsInterop?: boolean;
}

/**
 * Login, NOT interactive. A login shell sources ~/.profile, which is what puts
 * per-user install dirs (e.g. ~/.local/bin) on PATH — a plain `wsl.exe -- cmd`
 * gets neither and exits 127. Interactive (-i) is deliberately avoided: it also
 * loads ~/.bashrc, whose wrapper functions and version-manager hooks commonly
 * expect a TTY and abort with "open terminal failed" under a headless spawn.
 */
const WSL_SHELL = ['bash', '-lc'];

/** Quote a single argument for safe interpolation into a POSIX shell command line. */
function shQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Check whether a CLI is genuinely installed inside the distro (not a /mnt/c interop shim). */
export async function probeWslCli(distro: string, command: string): Promise<WslCliProbe> {
  const run = async (shell: string[]) => {
    const { stdout } = await execFileAsync(
      'wsl.exe',
      ['-d', distro, '--', ...shell, `command -v ${shQuote(command)}`],
      { env: { ...process.env, WSL_UTF8: '1' }, timeout: 20_000 }
    );
    // Shell startup files can print banners; the resolved path is the last line.
    return stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  };

  let resolved: string | undefined;
  try {
    resolved = await run(WSL_SHELL);
  } catch {
    // Distro without bash (e.g. Alpine) — fall back to a POSIX login shell.
    try {
      resolved = await run(['sh', '-lc']);
    } catch {
      return { found: false };
    }
  }

  // A bare name (not a path) means a shell function or alias — still runnable,
  // since the command goes through this same shell.
  if (!resolved) return { found: false };
  if (/^\/mnt\/[a-z]\//i.test(resolved)) {
    return { found: false, path: resolved, windowsInterop: true };
  }
  return { found: true, path: resolved };
}

/**
 * Rewrite a command so it runs inside the distro at `linuxCwd`.
 *
 * `--cd` is authoritative for the working directory, so the caller should give
 * the spawned Windows process a plain local cwd (a UNC cwd is unreliable under
 * ConPTY).
 *
 * The command goes through a login+interactive shell rather than being exec'd
 * directly: CLIs installed by a version manager are scripts whose `#!/usr/bin/env
 * node` shebang resolves against PATH, and a direct exec would find the Windows
 * node shim via /mnt/c interop and die. Args are quoted, so this stays a plain
 * argv — no shell injection surface.
 */
export function wrapWslCommand(
  distro: string,
  linuxCwd: string,
  command: string,
  args: string[]
): { command: string; args: string[] } {
  const cmdline = [command, ...args].map(shQuote).join(' ');
  return {
    command: 'wsl.exe',
    args: ['-d', distro, '--cd', linuxCwd, '--', ...WSL_SHELL, cmdline],
  };
}

/**
 * Interactive login shell inside the distro, for raw-shell terminal sessions.
 * Unlike wrapWslCommand this keeps -i: a raw shell always runs under a PTY, so
 * ~/.bashrc (prompt, aliases, version-manager hooks) both works and is wanted.
 */
export function wrapWslShell(distro: string, linuxCwd: string): { command: string; args: string[] } {
  return {
    command: 'wsl.exe',
    args: ['-d', distro, '--cd', linuxCwd, '--', 'bash', '-li'],
  };
}
