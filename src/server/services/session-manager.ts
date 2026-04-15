import { claudeManager } from './claude-manager.js';
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
    const workDir = project.path;

    // Mark as running
    queries.updateSessionStatus(sessionId, 'running');

    let pid: number;
    let exitPromise: Promise<number>;

    try {
      const result = await claudeManager.startClaude(
        workDir, prompt, cliModel, undefined, 'interactive', cliTool,
        undefined, workDir, undefined, false,
      );
      pid = result.pid;
      exitPromise = result.exitPromise;

      // Stream stdout/stderr to session_logs
      this.streamToSessionLogs(sessionId, result.stdout, result.stderr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queries.updateSessionStatus(sessionId, 'failed');
      queries.createSessionLog(sessionId, 'error', `Failed to start ${adapter.displayName}: ${message}`);
      broadcaster.broadcast({ type: 'session:status-changed', sessionId, status: 'failed' });
      return;
    }

    queries.updateSession(sessionId, { process_pid: pid });
    queries.createSessionLog(sessionId, 'output', `Started ${adapter.displayName} (PID: ${pid}) [interactive]`);
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
   * Simple plain-text log streaming for sessions.
   * Interactive mode always outputs plain text (not JSON).
   */
  private streamToSessionLogs(sessionId: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream): void {
    stdout.setEncoding('utf8' as BufferEncoding);
    stderr.setEncoding('utf8' as BufferEncoding);

    let stdoutBuffer = '';
    stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          queries.createSessionLog(sessionId, 'output', line.trim());
          broadcaster.broadcast({ type: 'session:log', sessionId, message: line.trim(), logType: 'output' });
        } catch { /* session may have been deleted */ }
      }
    });
    stdout.on('end', () => {
      if (stdoutBuffer.trim()) {
        try {
          queries.createSessionLog(sessionId, 'output', stdoutBuffer.trim());
          broadcaster.broadcast({ type: 'session:log', sessionId, message: stdoutBuffer.trim(), logType: 'output' });
        } catch { /* ignore */ }
      }
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
