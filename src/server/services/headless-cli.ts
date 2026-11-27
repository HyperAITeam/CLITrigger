import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CliTool } from './cli-adapters.js';

// One-shot classification calls (vault retrieval, discussion extraction) feed
// untrusted text — doc titles/previews, AI transcripts — to a CLI. They need
// no tools, so: no permission bypass, and an empty temp folder as cwd instead
// of the user's home.

// agy ≥1.5 takes the prompt only as the --print argument (stdin is ignored).
// agy is a real .exe, so it is spawned without cmd.exe and the prompt is never
// parsed by a shell. Stay under the Windows 32K command-line limit.
const AGY_MAX_PROMPT_CHARS = 30_000;

interface Invocation { command: string; args: string[]; viaStdin: boolean }

function buildInvocation(cliTool: CliTool, prompt: string): Invocation {
  switch (cliTool) {
    case 'antigravity': return { command: 'agy', args: ['--print', prompt], viaStdin: false };
    case 'codex': return { command: 'codex', args: ['exec'], viaStdin: true };
    case 'claude':
    default: return { command: 'claude', args: ['--print'], viaStdin: true };
  }
}

/** One-shot prompt → stdout through the CLI's non-interactive mode. */
export function runHeadless(cliTool: CliTool, prompt: string, timeoutMs = 180_000): Promise<string> {
  if (cliTool === 'antigravity' && prompt.length > AGY_MAX_PROMPT_CHARS) {
    return Promise.reject(new Error(`Prompt too long for Antigravity print mode (${prompt.length} chars)`));
  }
  return new Promise((resolve, reject) => {
    const { command, args, viaStdin } = buildInvocation(cliTool, prompt);
    // cmd.exe only for stdin-fed CLIs whose Windows entry is a .cmd shim (codex);
    // their args are fixed, so nothing untrusted reaches the shell.
    const useCmd = process.platform === 'win32' && viaStdin;
    const spawnCmd = useCmd ? 'cmd.exe' : command;
    const spawnArgs = useCmd ? ['/c', command, ...args] : args;
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clitrigger-headless-'));

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err: Error | null, out?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rm(cwd, { recursive: true, force: true }, () => { /* best effort */ });
      if (err) reject(err);
      else resolve(out ?? '');
    };

    const proc = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
      finish(new Error('Headless CLI timed out'));
    }, timeoutMs);

    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    proc.on('error', (err) => finish(err));
    proc.on('close', (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(`CLI exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
    });

    try {
      // Prompt via stdin: no Windows command-line length limit.
      if (viaStdin) proc.stdin.write(prompt + '\n');
      proc.stdin.end();
    } catch (err) {
      try { proc.kill(); } catch { /* ignore */ }
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function resolveCliTool(value: unknown): CliTool {
  if (value === 'claude' || value === 'antigravity' || value === 'codex') return value;
  return 'claude';
}
