import { spawn } from 'child_process';
import type { CliTool } from './cli-adapters.js';

function buildInvocation(cliTool: CliTool): { command: string; args: string[] } {
  switch (cliTool) {
    case 'antigravity': return { command: 'agy', args: ['--dangerously-skip-permissions', '--headless'] };
    case 'codex': return { command: 'codex', args: ['exec'] };
    case 'claude':
    default: return { command: 'claude', args: ['--print'] };
  }
}

/** One-shot prompt → stdout through the CLI's non-interactive mode. */
export function runHeadless(cliTool: CliTool, prompt: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const { command, args } = buildInvocation(cliTool);
    const isWin = process.platform === 'win32';
    const spawnCmd = isWin ? 'cmd.exe' : command;
    const spawnArgs = isWin ? ['/c', command, ...args] : args;

    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: process.env.HOME || process.env.USERPROFILE || '.',
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch { /* ignore */ }
      reject(new Error('Headless CLI timed out'));
    }, timeoutMs);

    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`CLI exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
    });

    try {
      proc.stdin.write(prompt + '\n');
      proc.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function resolveCliTool(value: unknown): CliTool {
  if (value === 'claude' || value === 'antigravity' || value === 'codex') return value;
  return 'claude';
}
