import { spawn, ChildProcess } from 'child_process';
import { getAdapter, type CliTool, type CliMode } from './cli-adapters.js';

export type ClaudeMode = CliMode;

export class ClaudeManager {
  private processes: Map<number, ChildProcess> = new Map();
  private stdinStreams: Map<number, NodeJS.WritableStream> = new Map();

  /**
   * Start a CLI tool in a worktree directory.
   * Spawns with shell to handle Windows .cmd shims.
   * mode: 'headless' uses args-based prompt, 'interactive' pipes stdin for user input.
   */
  async startClaude(worktreePath: string, prompt: string, model?: string, extraOptions?: string, mode: CliMode = 'headless', tool: CliTool = 'claude'): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
  }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      const adapter = getAdapter(tool);

      const args = adapter.buildArgs({ mode, prompt, model, extraOptions });
      const needsStdin = adapter.needsStdin(mode);

      try {
        child = spawn(adapter.command, args, {
          cwd: worktreePath,
          stdio: [needsStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          shell: true,
          windowsHide: true,
        });
      } catch (err) {
        reject(new Error(
          `Failed to spawn ${adapter.displayName}. Is it installed and on PATH? ${err instanceof Error ? err.message : String(err)}`
        ));
        return;
      }

      child.on('error', (err) => {
        reject(new Error(
          `Failed to start ${adapter.displayName}. Is it installed and on PATH? ${err.message}`
        ));
      });

      const pid = child.pid;
      if (pid === undefined) {
        reject(new Error(`Failed to get PID for ${adapter.displayName} process`));
        return;
      }

      this.processes.set(pid, child);

      // For non-headless modes, send prompt via stdin
      if (needsStdin && child.stdin) {
        child.stdin.write(adapter.formatStdinPrompt(prompt));
        if (mode === 'interactive') {
          // Keep stdin open for user input
          this.stdinStreams.set(pid, child.stdin);
        } else {
          // Streaming mode: close stdin so CLI works autonomously
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
   * Write data to the stdin of an interactive process.
   */
  writeToStdin(pid: number, data: string): boolean {
    const stdin = this.stdinStreams.get(pid);
    if (!stdin || (stdin as any).destroyed) return false;
    stdin.write(data);
    return true;
  }

  /**
   * Stop a CLI process. Sends SIGTERM first, then SIGKILL after 5 seconds.
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
