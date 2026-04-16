import { claudeManager } from './claude-manager.js';
import { worktreeManager } from './worktree-manager.js';
import { getAdapter, supportsInteractiveMode, type CliTool } from './cli-adapters.js';
import { broadcaster } from '../websocket/broadcaster.js';
import * as queries from '../db/queries.js';

export class SessionManager {
  /**
   * Start a session (always interactive mode).
   */
  async startSession(sessionId: string): Promise<void> {
    const session = queries.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    const project = queries.getProjectById(session.project_id);
    if (!project) throw new Error('Project not found');

    const cliTool = (session.cli_tool || project.cli_tool || 'claude') as CliTool;
    if (!supportsInteractiveMode(cliTool)) {
      throw new Error(`${cliTool} does not support interactive mode`);
    }

    const adapter = getAdapter(cliTool);
    const cliModel = session.cli_model || project.claude_model || undefined;
    const prompt = session.description || '';
    const useWorktree = !!session.use_worktree && !!project.is_git_repo;

    // Mark as running
    queries.updateSessionStatus(sessionId, 'running');

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
        branchName = worktreeManager.sanitizeBranchName(`session-${session.title}`);
        try {
          worktreePath = await worktreeManager.createWorktree(project.path, branchName);
          workDir = worktreePath;
          queries.createSessionLog(sessionId, 'output', `Created worktree on branch ${branchName}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          queries.updateSessionStatus(sessionId, 'failed');
          queries.createSessionLog(sessionId, 'error', `Failed to create worktree: ${message}`);
          broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'failed' });
          return;
        }
      }
    }

    let pid: number;
    let exitPromise: Promise<number>;

    try {
      const result = await claudeManager.startClaude(
        workDir, prompt, cliModel, undefined, 'interactive', cliTool,
        undefined, project.path, undefined, false,
      );
      pid = result.pid;
      exitPromise = result.exitPromise;

      // Stream stdout/stderr to session_logs
      this.streamToSessionLogs(sessionId, result.stdout, result.stderr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queries.updateSessionStatus(sessionId, 'failed');
      queries.createSessionLog(sessionId, 'error', `Failed to start ${adapter.displayName}: ${message}`);
      // Clean up worktree on failure
      if (useWorktree && worktreePath && !session.worktree_path) {
        try { await worktreeManager.removeWorktree(project.path, worktreePath); } catch { /* ignore */ }
      }
      broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'failed' });
      return;
    }

    queries.updateSession(sessionId, { process_pid: pid, branch_name: branchName, worktree_path: worktreePath });
    const logMsg = useWorktree
      ? `Started ${adapter.displayName} (PID: ${pid}) on branch ${branchName} [interactive]`
      : `Started ${adapter.displayName} (PID: ${pid}) [interactive]`;
    queries.createSessionLog(sessionId, 'output', logMsg);
    broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'running' });

    // Handle process exit
    exitPromise.then((exitCode) => {
      const current = queries.getSessionById(sessionId);
      if (current && current.status === 'running') {
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
      }
    }).catch(() => {
      try {
        queries.updateSessionStatus(sessionId, 'failed');
        queries.updateSession(sessionId, { process_pid: 0 });
      } catch { /* ignore */ }
      broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'failed' });
    });
  }

  /**
   * Stop a running session.
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = queries.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.process_pid) {
      await claudeManager.stopClaude(session.process_pid);
    }

    queries.updateSessionStatus(sessionId, 'stopped');
    queries.updateSession(sessionId, { process_pid: 0 });
    queries.createSessionLog(sessionId, 'output', 'Session stopped by user.');

    broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'stopped' });
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
