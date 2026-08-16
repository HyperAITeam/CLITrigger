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

/** Check whether a CLI is genuinely installed inside the distro (not a /mnt/c interop shim). */
export async function probeWslCli(distro: string, command: string): Promise<WslCliProbe> {
  try {
    const { stdout } = await execFileAsync(
      'wsl.exe',
      ['-d', distro, '--', 'sh', '-lc', `command -v ${command}`],
      { env: { ...process.env, WSL_UTF8: '1' }, timeout: 15_000 }
    );
    const resolved = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (!resolved) return { found: false };
    if (/^\/mnt\/[a-z]\//i.test(resolved)) {
      return { found: false, path: resolved, windowsInterop: true };
    }
    return { found: true, path: resolved };
  } catch {
    return { found: false };
  }
}

/**
 * Rewrite a command so it runs inside the distro at `linuxCwd`.
 * `--cd` is authoritative for the working directory, so the caller should give
 * the spawned Windows process a plain local cwd (a UNC cwd is unreliable under
 * ConPTY).
 */
export function wrapWslCommand(
  distro: string,
  linuxCwd: string,
  command: string,
  args: string[]
): { command: string; args: string[] } {
  return {
    command: 'wsl.exe',
    args: ['-d', distro, '--cd', linuxCwd, '--', command, ...args],
  };
}
