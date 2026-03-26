import { spawn, ChildProcess } from 'child_process';

export type ClaudeMode = 'headless' | 'interactive' | 'streaming';

export class ClaudeManager {
  private processes: Map<number, ChildProcess> = new Map();
  private stdinStreams: Map<number, NodeJS.WritableStream> = new Map();

  /**
   * Start Claude CLI in a worktree directory.
   * Spawns without shell to avoid escaping issues on Windows.
   * mode: 'headless' uses -p flag, 'interactive' pipes stdin for user input.
   */
  async startClaude(worktreePath: string, prompt: string, model?: string, extraOptions?: string, mode: ClaudeMode = 'headless'): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
  }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;

      const args = ['--dangerously-skip-permissions'];
      if (model) {
        args.push('--model', model);
      }
      if (extraOptions) {
        const extraArgs = extraOptions.split(/\s+/).filter(Boolean);
        args.push(...extraArgs);
      }

      const needsStdin = mode === 'interactive' || mode === 'streaming';

      if (!needsStdin) {
        args.push('-p', prompt);
      }

      try {
        // shell: true required on Windows where 'claude' is a .cmd shim
        child = spawn('claude', args, {
          cwd: worktreePath,
          stdio: [needsStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          shell: true,
          windowsHide: true,
        });
      } catch (err) {
        reject(new Error(
          `Failed to spawn Claude CLI. Is it installed and on PATH? ${err instanceof Error ? err.message : String(err)}`
        ));
        return;
      }

      child.on('error', (err) => {
        reject(new Error(
          `Failed to start Claude CLI. Is it installed and on PATH? ${err.message}`
        ));
      });

      const pid = child.pid;
      if (pid === undefined) {
        reject(new Error('Failed to get PID for Claude CLI process'));
        return;
      }

      this.processes.set(pid, child);

      // For non-headless modes, send prompt via stdin
      if (needsStdin && child.stdin) {
        child.stdin.write(prompt + '\n');
        if (mode === 'interactive') {
          // Keep stdin open for user input
          this.stdinStreams.set(pid, child.stdin);
        } else {
          // Streaming mode: close stdin so Claude works autonomously
          child.stdin.end();
        }
      }

      const exitPromise = new Promise<number>((resolveExit) => {
        child.on('exit', (code) => {
          this.processes.delete(pid);
          this.stdinStreams.delete(pid);
          resolveExit(code ?? 1);
        });
      });

      setImmediate(() => {
        resolve({
          pid,
          stdout: child.stdout!,
          stderr: child.stderr!,
          stdin: child.stdin ?? null,
          exitPromise,
        });
      });
    });
  }

  /**
   * Write data to the stdin of an interactive Claude process.
   */
  writeToStdin(pid: number, data: string): boolean {
    const stdin = this.stdinStreams.get(pid);
    if (!stdin || (stdin as any).destroyed) return false;
    stdin.write(data);
    return true;
  }

  /**
   * Stop a Claude CLI process. Sends SIGTERM first, then SIGKILL after 5 seconds.
   */
  async stopClaude(pid: number): Promise<void> {
    const child = this.processes.get(pid);
    if (!child) {
      return;
    }

    // End stdin stream before killing
    const stdin = this.stdinStreams.get(pid);
    if (stdin) {
      try { stdin.end(); } catch { /* ignore */ }
      this.stdinStreams.delete(pid);
    }

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process may already be dead
        }
      }, 5000);

      child.on('exit', () => {
        clearTimeout(killTimer);
        this.processes.delete(pid);
        resolve();
      });

      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(killTimer);
        this.processes.delete(pid);
        resolve();
      }
    });
  }

  isRunning(pid: number): boolean {
    const child = this.processes.get(pid);
    if (!child) return false;
    return !child.killed && child.exitCode === null;
  }

  async killAll(): Promise<void> {
    const pids = Array.from(this.processes.keys());
    await Promise.all(pids.map((pid) => this.stopClaude(pid)));
  }
}

export const claudeManager = new ClaudeManager();
