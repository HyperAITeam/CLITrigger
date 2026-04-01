import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';
import * as pty from 'node-pty';
import { getAdapter, type CliTool, type CliMode } from './cli-adapters.js';

export type ClaudeMode = CliMode;

interface ManagedProcess {
  kill(signal?: string): void;
  readonly pid: number;
}

export class ClaudeManager {
  private processes: Map<number, ManagedProcess> = new Map();
  private stdinStreams: Map<number, NodeJS.WritableStream> = new Map();

  /**
   * Start a CLI tool in a worktree directory.
   * Uses node-pty for tools that require a TTY (e.g. Codex),
   * falls back to child_process.spawn for others.
   */
  async startClaude(worktreePath: string, prompt: string, model?: string, extraOptions?: string, mode: CliMode = 'headless', tool: CliTool = 'claude', maxTurns?: number): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
  }> {
    const adapter = getAdapter(tool);
    const args = adapter.buildArgs({ mode, prompt, model, extraOptions, maxTurns });

    if (adapter.requiresTty) {
      const stdinPrompt = adapter.needsStdin(mode) ? adapter.formatStdinPrompt(prompt) : undefined;
      return this.startWithPty(adapter.command, args, worktreePath, adapter.displayName, stdinPrompt);
    }
    return this.startWithSpawn(adapter, args, worktreePath, prompt, mode);
  }

  /**
   * Spawn using node-pty for CLIs that require a TTY.
   */
  private startWithPty(command: string, args: string[], cwd: string, displayName: string, stdinPrompt?: string): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
  }> {
    return new Promise((resolve, reject) => {
      let ptyProcess: pty.IPty;
      try {
        // On Windows, use cmd.exe to resolve .cmd shims (e.g. codex.cmd)
        const ptyCommand = process.platform === 'win32' ? 'cmd.exe' : command;
        const ptyArgs = process.platform === 'win32' ? ['/c', command, ...args] : args;
        ptyProcess = pty.spawn(ptyCommand, ptyArgs, {
          name: 'xterm-256color',
          cols: 200,
          rows: 50,
          cwd,
        });
      } catch (err) {
        reject(new Error(
          `Failed to spawn ${displayName}. Is it installed and on PATH? ${err instanceof Error ? err.message : String(err)}`
        ));
        return;
      }

      const pid = ptyProcess.pid;
      // ANSI escape code stripper
      const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B\].*?(?:\x07|\x1B\\)|\x1B[()][A-Z0-9]|\x1B[>=<]|\x1B\[[\?]?[0-9;]*[hlJKm]/g, '');

      // Create a Readable stream from pty data (PTY merges stdout+stderr)
      const stdoutStream = new Readable({ read() {} });
      ptyProcess.onData((data) => {
        stdoutStream.push(stripAnsi(data));
      });

      // Empty stderr (PTY combines both streams)
      const stderrStream = new Readable({ read() {} });
      stderrStream.push(null);

      const managedProcess: ManagedProcess = {
        kill: () => { try { ptyProcess.kill(); } catch { /* ignore */ } },
        pid,
      };
      this.processes.set(pid, managedProcess);

      const exitPromise = new Promise<number>((resolveExit) => {
        ptyProcess.onExit(({ exitCode }) => {
          stdoutStream.push(null);
          this.processes.delete(pid);
          this.stdinStreams.delete(pid);
          resolveExit(exitCode);
        });
      });

      // Deliver prompt via PTY stdin if needed (avoids shell escaping issues)
      if (stdinPrompt) {
        setTimeout(() => {
          try { ptyProcess.write(stdinPrompt); } catch { /* PTY may have exited */ }
        }, 1500);
      }

      setImmediate(() => {
        resolve({
          pid,
          stdout: stdoutStream,
          stderr: stderrStream,
          stdin: null,
          exitPromise,
        });
      });
    });
  }

  /**
   * Spawn using child_process for standard CLIs.
   */
  private startWithSpawn(adapter: ReturnType<typeof getAdapter>, args: string[], cwd: string, prompt: string, mode: CliMode): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
  }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      const needsStdin = adapter.needsStdin(mode);

      try {
        child = spawn(adapter.command, args, {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          // shell needed on Windows to resolve .cmd shims (claude.cmd, gemini.cmd)
          // Safe: prompts are delivered via stdin, not as command-line arguments
          shell: process.platform === 'win32',
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

      const managedProcess: ManagedProcess = {
        kill: (signal?: string) => child.kill(signal as NodeJS.Signals),
        pid,
      };
      this.processes.set(pid, managedProcess);

      // Handle stdin based on mode
      if (needsStdin && child.stdin) {
        child.stdin.write(adapter.formatStdinPrompt(prompt));
        if (mode === 'interactive') {
          this.stdinStreams.set(pid, child.stdin);
        } else {
          child.stdin.end();
        }
      } else if (child.stdin) {
        child.stdin.end();
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
    const proc = this.processes.get(pid);
    if (!proc) {
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
          proc.kill('SIGKILL');
        } catch {
          // Process may already be dead
        }
      }, 5000);

      // For pty processes, kill resolves immediately
      // For child processes, we wait for exit event
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }

      // Give it time to exit, then resolve
      setTimeout(() => {
        clearTimeout(killTimer);
        this.processes.delete(pid);
        resolve();
      }, 1000);
    });
  }

  isRunning(pid: number): boolean {
    return this.processes.has(pid);
  }

  async killAll(): Promise<void> {
    const pids = Array.from(this.processes.keys());
    await Promise.all(pids.map((pid) => this.stopClaude(pid)));
  }
}

export const claudeManager = new ClaudeManager();
