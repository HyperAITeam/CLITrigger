import { spawn, ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import * as pty from 'node-pty';
import treeKill from 'tree-kill';
import { getAdapter, type CliAdapter, type CliTool, type CliMode, type SandboxMode } from './cli-adapters.js';
import { createPtyFilterState, filterInteractivePtyOutput, type PtyFilterState } from './pty-output-filter.js';

export type ClaudeMode = CliMode;

// node-pty ships its macOS/Linux `spawn-helper` as a prebuilt binary. Some npm
// extractions drop the executable bit, so `pty.fork` fails with
// "posix_spawnp failed." and every session shows a blank terminal. Restore +x
// once before the first spawn — self-healing covers --ignore-scripts installs
// and bits lost on reinstall. No-op on Windows (no spawn-helper).
let ptyHelperEnsured = false;
function ensurePtyHelperExecutable(): void {
  if (ptyHelperEnsured) return;
  ptyHelperEnsured = true;
  if (process.platform === 'win32') return;
  try {
    const require = createRequire(import.meta.url);
    const prebuildsDir = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds');
    for (const name of fs.readdirSync(prebuildsDir)) {
      const helper = path.join(prebuildsDir, name, 'spawn-helper');
      try {
        const st = fs.statSync(helper);
        if (!(st.mode & 0o111)) fs.chmodSync(helper, st.mode | 0o111);
      } catch { /* not present for this arch */ }
    }
  } catch { /* best-effort; manual chmod is the fallback */ }
}

interface ManagedProcess {
  kill(signal?: string): void;
  readonly pid: number;
}

interface RawRingBuffer {
  chunks: string[];
  bytes: number;
  max: number;
}

interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

export class ClaudeManager {
  private processes: Map<number, ManagedProcess> = new Map();
  private stdinStreams: Map<number, NodeJS.WritableStream> = new Map();
  private rawSubscribers: Map<number, Set<(chunk: string) => void>> = new Map();
  private rawRingBuffers: Map<number, RawRingBuffer> = new Map();
  private ptyHandles: Map<number, PtyHandle> = new Map();

  private appendRing(pid: number, chunk: string): void {
    const ring = this.rawRingBuffers.get(pid);
    if (!ring) return;
    ring.chunks.push(chunk);
    ring.bytes += Buffer.byteLength(chunk, 'utf8');
    while (ring.bytes > ring.max && ring.chunks.length > 1) {
      const dropped = ring.chunks.shift()!;
      ring.bytes -= Buffer.byteLength(dropped, 'utf8');
    }
  }

  /** Subscribe to the raw (un-stripped, un-filtered) PTY output for a pid. */
  subscribeRaw(pid: number, cb: (chunk: string) => void): () => void {
    let set = this.rawSubscribers.get(pid);
    if (!set) {
      set = new Set();
      this.rawSubscribers.set(pid, set);
    }
    set.add(cb);
    return () => this.unsubscribeRaw(pid, cb);
  }

  unsubscribeRaw(pid: number, cb: (chunk: string) => void): void {
    const set = this.rawSubscribers.get(pid);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) this.rawSubscribers.delete(pid);
  }

  /** Returns the buffered raw output (joined) for replay on (re)connect. */
  getRawHistory(pid: number): string {
    const ring = this.rawRingBuffers.get(pid);
    return ring ? ring.chunks.join('') : '';
  }

  /** Resize the PTY (cols, rows). No-op if pid is not a PTY. */
  resize(pid: number, cols: number, rows: number): boolean {
    const handle = this.ptyHandles.get(pid);
    if (!handle) return false;
    try { handle.resize(cols, rows); return true; }
    catch { return false; }
  }

  /**
   * Write raw bytes/keystrokes to the PTY without the `\n → submitSeq`
   * translation that `writeToStdin` applies. Used by xterm.js terminal input
   * where the client already sends raw key sequences (CR, arrow keys, etc).
   */
  writeStdinRaw(pid: number, data: string): boolean {
    const handle = this.ptyHandles.get(pid);
    if (!handle) return false;
    try { handle.write(data); return true; }
    catch { return false; }
  }

  /**
   * Start a CLI tool in a worktree directory.
   * Uses node-pty for tools that require a TTY (e.g. Codex),
   * falls back to child_process.spawn for others.
   */
  async startClaude(worktreePath: string, prompt: string, model?: string, extraOptions?: string, mode: CliMode = 'headless', tool: CliTool = 'claude', maxTurns?: number, projectPath?: string, sandboxMode?: SandboxMode, continueSession?: boolean, ptyCols?: number, ptyRows?: number): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
    command: string;
    args: string[];
  }> {
    const adapter = getAdapter(tool);
    const args = adapter.buildArgs({ mode, prompt, model, extraOptions, maxTurns, workDir: worktreePath, projectPath: projectPath || worktreePath, sandboxMode, continueSession });

    if (adapter.requiresTty || mode === 'interactive') {
      // Empty prompt (sessions stash the real prompt in pendingInitialPrompts and
      // deliver it later via writeToStdin) must NOT produce a stdinPrompt — the
      // delayStdinUntilReady path would otherwise write '\n'→submitSeq ('\r' or
      // '\r\n') to the PTY on ready, submitting the user's startupInputBuffer
      // type-ahead as if they pressed Enter.
      const stdinPrompt = adapter.needsStdin(mode) && prompt
        ? adapter.formatStdinPrompt(prompt, mode)
        : undefined;
      const result = await this.startWithPty(adapter, args, worktreePath, stdinPrompt, mode === 'interactive', ptyCols, ptyRows);
      return { ...result, command: adapter.command, args };
    }
    const result = await this.startWithSpawn(adapter, args, worktreePath, prompt, mode);
    return { ...result, command: adapter.command, args };
  }

  /**
   * Spawn using node-pty for CLIs that require a TTY.
   */
  private startWithPty(adapter: CliAdapter, args: string[], cwd: string, stdinPrompt?: string, interactive?: boolean, ptyCols?: number, ptyRows?: number): Promise<{
    pid: number;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    stdin: NodeJS.WritableStream | null;
    exitPromise: Promise<number>;
  }> {
    return new Promise((resolve, reject) => {
      const command = adapter.command;
      const displayName = adapter.displayName;
      const delayStdin = !!adapter.delayStdinUntilReady;
      const autoRespondRules = adapter.autoRespondRules ?? [];
      const readyPattern = adapter.readyIndicatorPattern;
      // PTY submit sequence: most Ink-based TUIs accept '\r', but Gemini
      // needs '\r\n'. Replaces a trailing '\n' on writes going to the PTY.
      const submitSeq = adapter.stdinSubmitSequence ?? '\r';

      let ptyProcess: pty.IPty;
      try {
        ensurePtyHelperExecutable();
        // On Windows, use cmd.exe to resolve .cmd shims (e.g. codex.cmd)
        const ptyCommand = process.platform === 'win32' ? 'cmd.exe' : command;
        const ptyArgs = process.platform === 'win32' ? ['/c', command, ...args] : args;
        ptyProcess = pty.spawn(ptyCommand, ptyArgs, {
          name: 'xterm-256color',
          cols: ptyCols ?? 200,
          rows: ptyRows ?? 50,
          cwd,
        });
      } catch (err) {
        reject(new Error(
          `Failed to spawn ${displayName}. Is it installed and on PATH? ${err instanceof Error ? err.message : String(err)}`
        ));
        return;
      }

      const pid = ptyProcess.pid;
      // Initialize raw ring buffer for this pid (256KB cap by default).
      this.rawRingBuffers.set(pid, { chunks: [], bytes: 0, max: 256 * 1024 });
      this.ptyHandles.set(pid, {
        write: (d) => { try { ptyProcess.write(d); } catch { /* exited */ } },
        resize: (cols, rows) => { try { ptyProcess.resize(cols, rows); } catch { /* exited */ } },
      });
      // ANSI escape code stripper — replaces cursor movement with spaces to preserve word gaps
      const stripAnsi = (str: string) => {
        // Step 1: Replace cursor movement/positioning sequences with a space
        // C=forward, G=column absolute, H/f=row;col position
        let result = str.replace(/\x1B\[\d*[CG]|\x1B\[\d+;\d+[Hf]/g, ' ');
        // Step 2: Strip all remaining ANSI sequences
        result = result.replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B\].*?(?:\x07|\x1B\\)|\x1B[()][A-Z0-9]|\x1B[>=<]|\x1B\[[\?]?[0-9;]*[hlJKm]/g, '');
        // Step 3: Collapse runs of multiple spaces into one
        result = result.replace(/ {2,}/g, ' ');
        return result;
      };

      // Create a Readable stream from pty data (PTY merges stdout+stderr)
      const stdoutStream = new Readable({ read() {} });
      let stdinDelivered = false;
      let exited = false;

      // Trust prompt tracking: block stdin delivery only while trust prompt is visible
      let trustPending = false;
      const filterState: PtyFilterState | null = interactive ? createPtyFilterState() : null;

      ptyProcess.onData((data) => {
        // Raw byte fan-out: feeds xterm.js terminal subscribers and history ring.
        // Decoupled from stripped/filtered path used by LogViewer/auto-respond.
        const subs = this.rawSubscribers.get(pid);
        if (subs && subs.size > 0) {
          for (const cb of subs) {
            try { cb(data); } catch { /* subscriber errors must not break PTY */ }
          }
        }
        this.appendRing(pid, data);

        const clean = stripAnsi(data);

        // Run adapter-defined auto-respond rules.
        // Blocking rules (trust dialogs) pin trustPending so the initial prompt is
        // deferred until the ready indicator reappears. Non-blocking rules (update
        // notices) dismiss themselves inline without holding back the main prompt.
        for (const rule of autoRespondRules) {
          if (!rule.pattern.test(clean)) continue;
          if (rule.blocksInitialPrompt) {
            if (!trustPending && !exited) {
              trustPending = true;
              try { ptyProcess.write(rule.response); } catch { /* PTY may have exited */ }
            }
          } else if (!exited) {
            try { ptyProcess.write(rule.response); } catch { /* PTY may have exited */ }
          }
        }

        // Clear blocking flag once the CLI is back at a ready indicator AND no
        // blocking rule still matches. Reset stdinDelivered so the initial prompt
        // is (re)sent — handles Gemini's in-process restart after trust approval.
        if (trustPending && readyPattern?.test(clean)) {
          const stillBlocking = autoRespondRules.some(r => r.blocksInitialPrompt && r.pattern.test(clean));
          if (!stillBlocking) {
            trustPending = false;
            stdinDelivered = false;
          }
        }

        // Detect CLI ready state and deliver the initial prompt via PTY stdin.
        // Non-delayed adapters send immediately in the fallback block below.
        if (delayStdin && stdinPrompt && !stdinDelivered && !exited && !trustPending) {
          const readyMatched = readyPattern?.test(clean) ?? false;
          if (readyMatched || /[›>$%⏵]\s*$/.test(clean) || /[☰○]\s*$/.test(clean)) {
            stdinDelivered = true;
            try { ptyProcess.write(stdinPrompt.replace(/\n$/, submitSeq)); } catch { /* PTY may have exited */ }
          }
        }

        // Push to stream — filter TUI noise for interactive mode
        if (filterState) {
          const filtered = filterInteractivePtyOutput(clean, filterState);
          if (filtered) stdoutStream.push(filtered);
        } else {
          stdoutStream.push(clean);
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
            try { ptyProcess.write(chunk.toString().replace(/\n$/, submitSeq)); } catch { /* PTY may have exited */ }
            callback();
          },
        });
        this.stdinStreams.set(pid, ptyWritable);
      }

      const exitPromise = new Promise<number>((resolveExit) => {
        ptyProcess.onExit(({ exitCode }) => {
          exited = true;
          // Flush remaining filter buffer before closing stream
          if (filterState?.lineBuffer) {
            const final = filterInteractivePtyOutput('\n', filterState);
            if (final) stdoutStream.push(final);
          }
          stdoutStream.push(null);
          this.processes.delete(pid);
          this.stdinStreams.delete(pid);
          this.rawSubscribers.delete(pid);
          this.rawRingBuffers.delete(pid);
          this.ptyHandles.delete(pid);
          resolveExit(exitCode);
        });
      });

      // Stdin delivery: immediate for adapters without delayStdin, otherwise
      // wait for the ready indicator (handled in onData) with a 5s fallback.
      if (stdinPrompt && !delayStdin) {
        setImmediate(() => {
          if (!stdinDelivered && !exited) {
            stdinDelivered = true;
            try { ptyProcess.write(stdinPrompt.replace(/\n$/, submitSeq)); } catch { /* PTY may have exited */ }
          }
        });
      } else if (stdinPrompt && delayStdin) {
        setTimeout(() => {
          if (!stdinDelivered && !exited) {
            stdinDelivered = true;
            try { ptyProcess.write(stdinPrompt.replace(/\n$/, submitSeq)); } catch { /* PTY may have exited */ }
          }
        }, 5000);
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
        child.stdin.write(adapter.formatStdinPrompt(prompt, mode));
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
