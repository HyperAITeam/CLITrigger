import { spawn, ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import * as pty from 'node-pty';
import treeKill from 'tree-kill';
import { getAdapter, type CliTool, type CliMode, type SandboxMode } from './cli-adapters.js';

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
  async startClaude(worktreePath: string, prompt: string, model?: string, extraOptions?: string, mode: CliMode = 'headless', tool: CliTool = 'claude', maxTurns?: number, projectPath?: string, sandboxMode?: SandboxMode): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
    command: string;
    args: string[];
  }> {
    const adapter = getAdapter(tool);
    const args = adapter.buildArgs({ mode, prompt, model, extraOptions, maxTurns, workDir: worktreePath, projectPath: projectPath || worktreePath, sandboxMode });

    if (adapter.requiresTty || mode === 'interactive') {
      const stdinPrompt = adapter.needsStdin(mode) ? adapter.formatStdinPrompt(prompt) : undefined;
      const result = await this.startWithPty(adapter.command, args, worktreePath, adapter.displayName, stdinPrompt, mode === 'interactive');
      return { ...result, command: adapter.command, args };
    }
    const result = await this.startWithSpawn(adapter, args, worktreePath, prompt, mode);
    return { ...result, command: adapter.command, args };
  }

  /**
   * Spawn using node-pty for CLIs that require a TTY.
   */
  private startWithPty(command: string, args: string[], cwd: string, displayName: string, stdinPrompt?: string, interactive?: boolean): Promise<{
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
      let stdinDelivered = false;
      let exited = false;

      ptyProcess.onData((data) => {
        const clean = stripAnsi(data);
        stdoutStream.push(clean);

        // Detect CLI ready state and deliver prompt via stdin.
        // Codex outputs '›' when ready for input. We also detect common
        // prompt characters ($, >, %) as fallback for other PTY-based CLIs.
        // A 10-second fallback timer ensures delivery even if detection fails.
        if (stdinPrompt && !stdinDelivered && !exited) {
          if (/[›>$%]\s*$/.test(clean)) {
            stdinDelivered = true;
            try { ptyProcess.write(stdinPrompt); } catch { /* PTY may have exited */ }
          }
        }
      });

      // Empty stderr (PTY combines both streams)
      const stderrStream = new Readable({ read() {} });
      stderrStream.push(null);

      const managedProcess: ManagedProcess = {
        kill: () => { try { ptyProcess.kill(); } catch { /* ignore */ } },
        pid,
      };
      this.processes.set(pid, managedProcess);

      // For interactive mode, expose PTY write as a stdin stream for relay
      if (interactive) {
        const ptyWritable = new Writable({
          write(chunk: Buffer | string, _encoding: string, callback: () => void) {
            try { ptyProcess.write(chunk.toString()); } catch { /* PTY may have exited */ }
            callback();
          },
        });
        this.stdinStreams.set(pid, ptyWritable);
      }

      const exitPromise = new Promise<number>((resolveExit) => {
        ptyProcess.onExit(({ exitCode }) => {
          exited = true;
          stdoutStream.push(null);
          this.processes.delete(pid);
          this.stdinStreams.delete(pid);
          resolveExit(exitCode);
        });
      });

      // Fallback: if ready-state detection doesn't trigger within 10s, send anyway
      if (stdinPrompt) {
        setTimeout(() => {
          if (!stdinDelivered && !exited) {
            stdinDelivered = true;
            try { ptyProcess.write(stdinPrompt); } catch { /* PTY may have exited */ }
          }
        }, 10000);
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
   * Stop a CLI process. Uses tree-kill to kill the entire process tree
   * (necessary on Windows where shell: true wraps CLIs in cmd.exe).
   * Sends SIGTERM first, escalates to SIGKILL after 5 seconds.
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

    // Try graceful tree-kill first (kills entire process tree)
    try { treeKill(pid, 'SIGTERM'); } catch { /* ignore */ }

    return new Promise<void>((resolve) => {
      // Poll for process exit (exit handler in startWithSpawn/startWithPty deletes from map)
      const checkInterval = setInterval(() => {
        if (!this.processes.has(pid)) {
          clearInterval(checkInterval);
          clearTimeout(killTimer);
          clearTimeout(deadline);
          resolve();
        }
      }, 200);

      // Escalate to SIGKILL after 5 seconds if still alive
      const killTimer = setTimeout(() => {
        try { treeKill(pid, 'SIGKILL'); } catch { /* ignore */ }
      }, 5000);

      // Final deadline: force-cleanup and resolve after 7 seconds
      const deadline = setTimeout(() => {
        clearInterval(checkInterval);
        clearTimeout(killTimer);
        this.processes.delete(pid);
        resolve();
      }, 7000);
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
