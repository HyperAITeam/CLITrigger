import { spawn, ChildProcess } from 'child_process';

export class ClaudeManager {
  private processes: Map<number, ChildProcess> = new Map();

  /**
   * Start Claude CLI in a worktree directory.
   * Command: claude --dangerously-skip-permissions -p "<prompt>"
   * Returns the PID, stdout/stderr streams, and an exit promise.
   */
  async startClaude(worktreePath: string, prompt: string): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    exitPromise: Promise<number>;
  }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;

      try {
        child = spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], {
          cwd: worktreePath,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
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

      // Wait briefly for potential spawn errors before resolving
      const pid = child.pid;
      if (pid === undefined) {
        reject(new Error('Failed to get PID for Claude CLI process'));
        return;
      }

      this.processes.set(pid, child);

      const exitPromise = new Promise<number>((resolveExit) => {
        child.on('exit', (code) => {
          this.processes.delete(pid);
          resolveExit(code ?? 1);
        });
      });

      // Use setImmediate to allow spawn error events to fire first
      setImmediate(() => {
        resolve({
          pid,
          stdout: child.stdout!,
          stderr: child.stderr!,
          exitPromise,
        });
      });
    });
  }

  /**
   * Stop a Claude CLI process. Sends SIGTERM first, then SIGKILL after 5 seconds.
   */
  async stopClaude(pid: number): Promise<void> {
    const child = this.processes.get(pid);
    if (!child) {
      return;
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
        // Process may already be dead
        clearTimeout(killTimer);
        this.processes.delete(pid);
        resolve();
      }
    });
  }

  /**
   * Check if a process is still running.
   */
  isRunning(pid: number): boolean {
    const child = this.processes.get(pid);
    if (!child) return false;
    return !child.killed && child.exitCode === null;
  }

  /**
   * Kill all tracked processes (for cleanup on shutdown).
   */
  async killAll(): Promise<void> {
    const pids = Array.from(this.processes.keys());
    await Promise.all(pids.map((pid) => this.stopClaude(pid)));
  }
}

export const claudeManager = new ClaudeManager();
