import { claudeManager } from './claude-manager.js';
import { worktreeManager } from './worktree-manager.js';
import { getAdapter, supportsInteractiveMode, type CliTool } from './cli-adapters.js';
import { broadcaster, encodeSessionFrame } from '../websocket/broadcaster.js';
import { applyMemoryInjection } from './memory-inject-hook.js';
import { parseMemoryNodeIds, parseRawFilePaths, type MemoryInjectMode } from './memory-injector.js';
import { broadcastProjectStatus } from './project-status.js';
import { snapshotWorkingTree } from '../lib/git-diff.js';
import * as queries from '../db/queries.js';

const RAW_FLUSH_BYTES = 4 * 1024;
const RAW_FLUSH_MS = 100;
const RAW_DB_CAP_BYTES = 2 * 1024 * 1024;
// Enforce the DB cap only after this many bytes have been appended since the
// last trim — trimming on every flush scanned the whole per-session chunk
// table every ≤100ms and blocked the event loop under heavy TUI output.
const RAW_TRIM_EVERY_BYTES = 256 * 1024;

export class SessionManager {
  // Per-session pending-flush callback so we can drain the byte buffer when
  // the PTY exits or the user stops the session.
  private pendingFlushers: Map<string, () => void> = new Map();

  // Initial prompts (description + optional injected wiki) that have NOT been
  // submitted to the PTY yet. We hold them so the user gets to review the
  // payload — including any auto-retrieved wiki nodes — and explicitly hit
  // Send (or Skip) instead of having the prompt fire the moment the CLI
  // emits its ready indicator.
  private pendingInitialPrompts: Map<string, string> = new Map();

  // Per-session type-ahead queue. While the session has status='running'
  // but the PTY hasn't spawned yet (process_pid still 0), every
  // terminal-input WS message is appended here instead of being dropped
  // or written to a non-existent PTY. A buffer presence is the gate —
  // `writeTerminalInput` always checks the map first; the drain block at
  // the end of `startSession` deletes the entry atomically with the
  // process_pid DB update so subsequent input goes straight to the PTY
  // without any reordering window.
  private startupInputBuffer: Map<string, string[]> = new Map();

  // sessionId → live PTY pid. Keystroke routing hot path: writeTerminalInput
  // fires on every WS terminal-input message, and looking the pid up in the
  // DB per keystroke stalls input echo whenever SQLite is busy with raw-chunk
  // flushes. Populated by the drain block in startSession, cleared on
  // stop/exit; the DB lookup remains as the fallback for cache misses.
  private livePids: Map<string, number> = new Map();

  /**
   * Hook the raw PTY byte stream of `pid` into:
   *   1. live binary WS frames to currently subscribed clients
   *   2. batched (≥4KB or 100ms) appends to `session_raw_chunks` for replay
   *
   * Memory-bounded by the upstream ring buffer in claudeManager and by
   * `trimSessionRawChunks` (~2MB rolling) on the DB side.
   */
  private subscribeRawForSession(sessionId: string, pid: number): void {
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let bytesSinceTrim = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (pending.length === 0) return;
      const buf = Buffer.concat(pending);
      pending = [];
      pendingBytes = 0;
      try {
        queries.appendSessionRawChunk(sessionId, buf);
        bytesSinceTrim += buf.length;
        if (bytesSinceTrim >= RAW_TRIM_EVERY_BYTES) {
          bytesSinceTrim = 0;
          queries.trimSessionRawChunks(sessionId, RAW_DB_CAP_BYTES);
        }
      } catch { /* DB may be locked or session deleted; drop chunk */ }
    };

    claudeManager.subscribeRaw(pid, (chunk) => {
      const buf = Buffer.from(chunk, 'utf8');
      pending.push(buf);
      pendingBytes += buf.length;

      // Live broadcast — only currently-subscribed clients receive the bytes.
      try {
        broadcaster.sendBinaryToSubscribers(sessionId, encodeSessionFrame(sessionId, buf));
      } catch { /* ignore */ }

      if (pendingBytes >= RAW_FLUSH_BYTES) {
        flush();
      } else if (!timer) {
        timer = setTimeout(flush, RAW_FLUSH_MS);
      }
    });

    this.pendingFlushers.set(sessionId, flush);
  }

  private flushAndForgetRaw(sessionId: string): void {
    const flusher = this.pendingFlushers.get(sessionId);
    if (flusher) {
      try { flusher(); } catch { /* ignore */ }
      this.pendingFlushers.delete(sessionId);
    }
  }

  /**
   * Drain any in-flight raw bytes for `sessionId` to `session_raw_chunks`
   * without tearing down the subscription. Call this immediately before
   * reading DB chunks for replay so the persisted history is the single
   * source of truth — otherwise the in-memory PTY ring would still hold
   * the most recent ~100ms of bytes and replaying both would duplicate.
   */
  flushPendingRaw(sessionId: string): void {
    const flusher = this.pendingFlushers.get(sessionId);
    if (!flusher) return;
    try { flusher(); } catch { /* ignore */ }
  }

  /**
   * Start a session (always interactive mode).
   *
   * `opts.cols` / `opts.rows` come from the client xterm.js after FitAddon
   * resolves. Spawning the PTY at the actual rendered size avoids the
   * 200x50-default-then-resize race where Claude Code's TUI banner ends up
   * misaligned in scrollback. If the caller doesn't supply dims (e.g.
   * plugin or curl direct hit), fall back to 100x30 — small enough that a
   * later wider client still renders the welcome banner cleanly.
   */
  async startSession(sessionId: string, opts?: { cols?: number; rows?: number; continueSession?: boolean }): Promise<void> {
    const session = queries.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    const project = queries.getProjectById(session.project_id);
    if (!project) throw new Error('Project not found');

    const cliTool = (session.cli_tool || project.cli_tool || 'claude') as CliTool;
    if (!supportsInteractiveMode(cliTool)) {
      throw new Error(`${cliTool} does not support interactive mode`);
    }
    const isRawShell = cliTool === 'raw-shell';

    const useWorktree = !!session.use_worktree && !!project.is_git_repo;
    const resume = !!opts?.continueSession;
    if (resume) {
      if (isRawShell) {
        throw new Error('Resume is not supported for raw shell sessions');
      }
      // --continue is currently only wired for Claude in interactive mode.
      // Antigravity/Codex have the adapter flag but their interactive resume is
      // not yet validated, so reject early with a clear message.
      if (cliTool !== 'claude') {
        throw new Error('Resume is only supported for Claude sessions');
      }
      // claude --continue picks the latest conversation in the cwd. If the
      // session runs at the project root, that latest can easily be a todo
      // executor's conversation — refuse and force a worktree session.
      if (!useWorktree || !session.worktree_path) {
        throw new Error('Resume requires a worktree session');
      }
    }

    const adapter = getAdapter(cliTool);
    // Model selection was removed — always the CLI's default model; legacy
    // session.cli_model / project.claude_model values are ignored.
    const cliModel = undefined;
    let prompt = session.description || '';

    // Inject long-term memory if configured for this session. Mirrors the
    // todo/discussion flow: prepend a <long_term_memory> block to the initial
    // PTY prompt so the CLI sees both the wiki context and the user's request
    // as one combined first turn. Skipped on resume — the prior conversation
    // already contains the same block, and we don't want to fire a fresh
    // initial prompt on top of restored history.
    // Raw-shell never consumes a prompt at all — it's a regular OS shell —
    // so memory injection is unconditionally skipped.
    const memMode = ((session.memory_inject_mode as MemoryInjectMode | null) || 'none') as MemoryInjectMode;
    const rawFilePaths = parseRawFilePaths(session.memory_raw_file_paths);
    if (!isRawShell && !resume && (memMode !== 'none' || rawFilePaths.length > 0)) {
      const memBlock = await applyMemoryInjection({
        projectId: project.id,
        mode: memMode,
        nodeIds: parseMemoryNodeIds(session.memory_node_ids),
        rawFilePaths,
        vaultFilePaths: rawFilePaths,
        projectRoot: project.path,
        query: `${session.title}\n${session.description ?? ''}`.trim(),
        log: (type, message) => queries.createSessionLog(sessionId, type, message),
      });
      if (memBlock) {
        prompt = prompt ? `${memBlock}\n\n${prompt}` : memBlock;
      }
    }

    // Decide whether to hold the initial prompt for Send/Skip BEFORE flipping
    // status='running' so the WS handler's gate-1 (`hasPendingPrompt`) covers
    // the entire spawn window. Otherwise type-ahead arriving in the
    // [status=running, pendingPrompt-not-yet-set] window would slip past the
    // gate, land in startupInputBuffer, then get drained into the PTY
    // before the held description is dispatched.
    // Raw-shell never auto-submits an initial prompt — running an arbitrary
    // string in a shell would execute it as a command, which is unsafe and
    // not what "session description" means for raw shells.
    if (!isRawShell && !resume && prompt.trim()) {
      this.pendingInitialPrompts.set(sessionId, prompt);
    } else {
      this.pendingInitialPrompts.delete(sessionId);
    }

    // Mark as running and open the type-ahead buffer in lockstep. From this
    // point until the drain block below, every terminal-input WS message
    // lands in the buffer so the user can start typing while the PTY is
    // still spawning.
    queries.updateSessionStatus(sessionId, 'running');
    this.startupInputBuffer.set(sessionId, []);

    let workDir = project.path;
    let worktreePath: string | null = null;
    let branchName: string | null = null;

    // Worktree setup
    if (useWorktree) {
      // Reuse existing worktree if available
      if (session.worktree_path && session.branch_name && await worktreeManager.isValidWorktree(session.worktree_path)) {
        worktreePath = session.worktree_path;
        branchName = session.branch_name;
        workDir = worktreePath;
        queries.createSessionLog(sessionId, 'output', `Reusing existing worktree on branch ${branchName}`);
      } else {
        const requestedBranch = worktreeManager.sanitizeBranchName(`session-${session.title}`);
        try {
          const created = await worktreeManager.createWorktree(project.path, requestedBranch, !!project.npm_auto_install);
          worktreePath = created.worktreePath;
          branchName = created.branchName;
          workDir = worktreePath;
          queries.createSessionLog(sessionId, 'output', `Created worktree on branch ${branchName}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.startupInputBuffer.delete(sessionId);
          this.pendingInitialPrompts.delete(sessionId);
          queries.updateSessionStatus(sessionId, 'failed');
          queries.createSessionLog(sessionId, 'error', `Failed to create worktree: ${message}`);
          broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'failed' });
          broadcastProjectStatus(session.project_id);
          return;
        }
      }
    }

    // Snapshot the working tree once at first start (kept across resume) as the
    // baseline for the Diff view. A full snapshot — not just HEAD — so that on a
    // shared/main checkout, changes already present before the session started
    // (e.g. a stray untracked file) are excluded; only what the session itself
    // changes shows up. See snapshotWorkingTree().
    const baseCommit: string | null = session.base_commit ?? null;
    // Capture is deferred to after PTY spawn (fire-and-forget) so a large-repo
    // tree scan doesn't block terminal start — see the snapshot kickoff below.
    const needsSnapshot = !baseCommit && project.is_git_repo;

    let pid: number;
    let exitPromise: Promise<number>;

    try {
      const result = await claudeManager.startClaude(
        workDir, '', cliModel, undefined, 'interactive', cliTool,
        undefined, project.path, undefined, resume,
        opts?.cols ?? 100, opts?.rows ?? 30,
      );
      pid = result.pid;
      exitPromise = result.exitPromise;

      // Subscribe to raw PTY bytes for the xterm.js terminal channel.
      // The legacy stripped-text streamToSessionLogs path is intentionally
      // skipped — Sessions now show the real terminal, and storing classified
      // session_logs on every spinner frame is wasted DB churn.
      this.subscribeRawForSession(sessionId, pid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.startupInputBuffer.delete(sessionId);
      this.pendingInitialPrompts.delete(sessionId);
      queries.updateSessionStatus(sessionId, 'failed');
      queries.createSessionLog(sessionId, 'error', `Failed to start ${adapter.displayName}: ${message}`);
      // Clean up worktree on failure
      if (useWorktree && worktreePath && !session.worktree_path) {
        try { await worktreeManager.removeWorktree(project.path, worktreePath); } catch { /* ignore */ }
      }
      broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'failed' });
      broadcastProjectStatus(session.project_id);
      return;
    }

    // Atomic drain: persist process_pid, remove the buffer, replay queued
    // bytes — all in a single synchronous block. JS being single-threaded
    // guarantees no WS message can sneak between the DB update and the
    // map.delete, so a message arriving on the next event-loop tick will
    // see process_pid set and no buffer, and write straight to the PTY in
    // correct order after the replayed bytes.
    queries.updateSession(sessionId, { process_pid: pid, branch_name: branchName, worktree_path: worktreePath, base_commit: baseCommit });
    this.livePids.set(sessionId, pid);
    const queued = this.startupInputBuffer.get(sessionId);
    this.startupInputBuffer.delete(sessionId);
    if (queued && queued.length > 0) {
      for (const input of queued) {
        try { claudeManager.writeStdinRaw(pid, input); } catch { /* ignore */ }
      }
    }

    // ponytail: fire-and-forget — a large-repo `git add -A` tree scan must not block PTY start.
    // base_commit is only read when the Diff panel opens, and a null base degrades to HEAD there
    // (resolveSessionDiff, routes/sessions.ts). Races the CLI's own early edits in theory; the CLI
    // takes seconds to boot before its first write, so the scan normally reads the pre-edit tree.
    // If exact session scoping is ever required, await this before draining keystrokes above.
    if (needsSnapshot) {
      snapshotWorkingTree(workDir)
        .then((base) => { if (base) queries.updateSession(sessionId, { base_commit: base }); })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          queries.createSessionLog(sessionId, 'error', `Diff base snapshot failed: ${message}`);
        });
    }
    const logMsg = useWorktree
      ? `Started ${adapter.displayName} (PID: ${pid}) on branch ${branchName} [interactive]`
      : `Started ${adapter.displayName} (PID: ${pid}) [interactive]`;
    queries.createSessionLog(sessionId, 'output', logMsg);
    if (resume) {
      queries.createSessionLog(
        sessionId,
        'output',
        `Resumed Claude session via --continue (cwd: ${workDir}) — picks latest conversation in this directory`,
      );
    }
    broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'running', worktree_path: worktreePath, branch_name: branchName });
    broadcastProjectStatus(session.project_id);

    // Handle process exit
    exitPromise.then((exitCode) => {
      // Flush any pending raw bytes before status update so re-opening the
      // session immediately shows the final output.
      this.flushAndForgetRaw(sessionId);
      // Guard: a stop-then-restart may have already mapped a NEW pid.
      if (this.livePids.get(sessionId) === pid) this.livePids.delete(sessionId);
      this.pendingInitialPrompts.delete(sessionId);
      this.startupInputBuffer.delete(sessionId);
      const current = queries.getSessionById(sessionId);
      // pid guard: a session stopped-then-restarted during the kill window has
      // a new process_pid — the old process's exit must not clobber it.
      if (current && current.status === 'running' && current.process_pid === pid) {
        const status = exitCode === 0 ? 'completed' : 'failed';
        const msg = exitCode === 0
          ? `${adapter.displayName} session completed.`
          : `${adapter.displayName} exited with code ${exitCode}.`;
        try {
          queries.updateSessionStatus(sessionId, status);
          queries.createSessionLog(sessionId, exitCode === 0 ? 'output' : 'error', msg);
          queries.updateSession(sessionId, { process_pid: 0 });
        } catch {
          try { queries.updateSessionStatus(sessionId, status); } catch { /* ignore */ }
        }
        broadcaster.broadcast({ type: 'session:log', sessionId, message: msg, logType: exitCode === 0 ? 'output' : 'error' });
        broadcaster.broadcast({ type: 'session:status-changed', sessionId, status });
        broadcastProjectStatus(session.project_id);
      }
    }).catch(() => {
      this.flushAndForgetRaw(sessionId);
      if (this.livePids.get(sessionId) === pid) this.livePids.delete(sessionId);
      this.pendingInitialPrompts.delete(sessionId);
      this.startupInputBuffer.delete(sessionId);
      try {
        queries.updateSessionStatus(sessionId, 'failed');
        queries.updateSession(sessionId, { process_pid: 0 });
      } catch { /* ignore */ }
      broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'failed' });
      broadcastProjectStatus(session.project_id);
    });
  }

  /**
   * Stop a running session.
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = queries.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');
    const pid = session.process_pid;

    // Mark stopped + broadcast BEFORE the (up to 7s) graceful kill so the UI
    // updates immediately; the exit handler's guards then skip this session.
    this.livePids.delete(sessionId);
    queries.updateSessionStatus(sessionId, 'stopped');
    queries.updateSession(sessionId, { process_pid: 0 });
    queries.createSessionLog(sessionId, 'output', 'Session stopped by user.');
    broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'stopped' });
    broadcastProjectStatus(session.project_id);

    if (pid) {
      await claudeManager.stopClaude(pid);
    }
    this.flushAndForgetRaw(sessionId);
    this.pendingInitialPrompts.delete(sessionId);
    this.startupInputBuffer.delete(sessionId);
  }

  /**
   * Route a `session:terminal-input` WS payload to the right destination.
   * If the session is mid-spawn (`startupInputBuffer` has an entry) the
   * bytes are queued for the drain block at the end of `startSession`,
   * preserving the user's type-ahead in order. Otherwise the bytes are
   * written straight to the PTY — but only if the session is actually
   * running with a live process_pid, so a stray write to a dead session
   * is silently dropped.
   *
   * Note: the WS handler still gates on `hasPendingPrompt` before calling
   * this, so type-ahead never leaks past the Send/Skip pre-flight.
   */
  writeTerminalInput(sessionId: string, input: string): void {
    const buf = this.startupInputBuffer.get(sessionId);
    if (buf) {
      buf.push(input);
      return;
    }
    // Hot path: avoid a synchronous DB read per keystroke.
    const pid = this.livePids.get(sessionId);
    if (pid) {
      try { claudeManager.writeStdinRaw(pid, input); } catch { /* ignore */ }
      return;
    }
    const session = queries.getSessionById(sessionId);
    if (!session || session.status !== 'running' || !session.process_pid) return;
    try { claudeManager.writeStdinRaw(session.process_pid, input); } catch { /* ignore */ }
  }

  /**
   * Submit the held initial prompt to the running PTY. The payload is
   * terminated with `\n` so claudeManager's ptyWritable converts it to the
   * adapter's submit sequence (\r for Claude/Codex, \r\n for Antigravity).
   * Returns false if there's no pending prompt or the PTY is gone.
   */
  submitInitialPrompt(sessionId: string): boolean {
    const prompt = this.pendingInitialPrompts.get(sessionId);
    if (!prompt) return false;

    const session = queries.getSessionById(sessionId);
    if (!session?.process_pid) return false;

    const payload = prompt.endsWith('\n') ? prompt : `${prompt}\n`;
    const ok = claudeManager.writeToStdin(session.process_pid, payload);
    if (ok) {
      this.pendingInitialPrompts.delete(sessionId);
      queries.createSessionLog(
        sessionId,
        'output',
        `[memory] initial prompt submitted (${prompt.length} chars)`,
      );
    }
    return ok;
  }

  /** Discard the held initial prompt without sending anything to the PTY. */
  skipInitialPrompt(sessionId: string): void {
    if (this.pendingInitialPrompts.has(sessionId)) {
      this.pendingInitialPrompts.delete(sessionId);
      queries.createSessionLog(sessionId, 'output', '[memory] initial prompt skipped by user');
    }
  }

  /** Full body of the held initial prompt, or null if none. */
  getPendingPrompt(sessionId: string): string | null {
    return this.pendingInitialPrompts.get(sessionId) ?? null;
  }

  hasPendingPrompt(sessionId: string): boolean {
    return this.pendingInitialPrompts.has(sessionId);
  }

  /**
   * Classify a filtered PTY output line into a log type.
   * Heuristic: ● prefix = assistant response, [Tool: ...] = tool call, else = output.
   */
  private classifyPtyLine(line: string): { logType: string; message: string } {
    // Claude TUI response lines start with ● (bullet)
    if (/^●\s/.test(line)) {
      return { logType: 'assistant', message: line.replace(/^●\s*/, '') };
    }
    // Tool call lines: [Tool: Read], ⏺ Read(file_path: ...), etc.
    if (/^\[Tool:\s*\w+\]/.test(line)) {
      const match = line.match(/^\[Tool:\s*(\w+)\]\s*(.*)/);
      if (match) {
        return { logType: 'tool_use', message: JSON.stringify({ tool: match[1], summary: match[2].trim() }) };
      }
    }
    // Tool call variant: ⏺ ToolName (shown in some TUI versions)
    if (/^⏺\s+\w+/.test(line)) {
      const match = line.match(/^⏺\s+(\w+)\s*(.*)/);
      if (match) {
        return { logType: 'tool_use', message: JSON.stringify({ tool: match[1], summary: match[2].trim() }) };
      }
    }
    return { logType: 'output', message: line };
  }

  /**
   * Stream PTY output to session logs with heuristic classification.
   * Accumulates consecutive assistant lines into a single log entry.
   */
  private streamToSessionLogs(sessionId: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream): void {
    stdout.setEncoding('utf8' as BufferEncoding);
    stderr.setEncoding('utf8' as BufferEncoding);

    // Accumulator for consecutive assistant lines (merged into one block)
    let assistantBuffer: string[] = [];
    let assistantFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushAssistant = () => {
      if (assistantBuffer.length === 0) return;
      const text = assistantBuffer.join('\n');
      assistantBuffer = [];
      try {
        queries.createSessionLog(sessionId, 'assistant', text);
        broadcaster.broadcast({ type: 'session:log', sessionId, message: text, logType: 'assistant' });
      } catch { /* session may have been deleted */ }
    };

    const processStdoutLine = (line: string) => {
      const { logType, message } = this.classifyPtyLine(line);

      if (logType === 'assistant') {
        // Accumulate assistant lines; flush after 300ms gap or on non-assistant line
        assistantBuffer.push(message);
        if (assistantFlushTimer) clearTimeout(assistantFlushTimer);
        assistantFlushTimer = setTimeout(flushAssistant, 300);
        return;
      }

      // Non-assistant line: flush any buffered assistant text first
      if (assistantBuffer.length > 0) {
        if (assistantFlushTimer) { clearTimeout(assistantFlushTimer); assistantFlushTimer = null; }
        flushAssistant();
      }

      try {
        queries.createSessionLog(sessionId, logType, message);
        broadcaster.broadcast({ type: 'session:log', sessionId, message, logType });
      } catch { /* session may have been deleted */ }
    };

    let stdoutBuffer = '';
    stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        processStdoutLine(line.trim());
      }
    });
    stdout.on('end', () => {
      if (stdoutBuffer.trim()) {
        processStdoutLine(stdoutBuffer.trim());
      }
      // Flush remaining assistant buffer
      if (assistantFlushTimer) { clearTimeout(assistantFlushTimer); assistantFlushTimer = null; }
      flushAssistant();
    });

    let stderrBuffer = '';
    stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          queries.createSessionLog(sessionId, 'error', line.trim());
          broadcaster.broadcast({ type: 'session:log', sessionId, message: line.trim(), logType: 'error' });
        } catch { /* ignore */ }
      }
    });
    stderr.on('end', () => {
      if (stderrBuffer.trim()) {
        try {
          queries.createSessionLog(sessionId, 'error', stderrBuffer.trim());
          broadcaster.broadcast({ type: 'session:log', sessionId, message: stderrBuffer.trim(), logType: 'error' });
        } catch { /* ignore */ }
      }
    });
  }
}

export const sessionManager = new SessionManager();
