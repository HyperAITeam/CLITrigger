import { spawn } from 'child_process';
import * as queries from '../db/queries.js';
import { broadcaster } from '../websocket/broadcaster.js';

export interface TokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  total_cost: number | null;
  duration_ms: number | null;
  num_turns: number | null;
  context_window: number | null;
}

const CONTEXT_EXHAUSTION_PATTERN = /context.*(window|limit|length|exceeded)|conversation.*(too long|limit)|token.*(limit|exceeded)|max.*context|context_length_exceeded/i;

/** Pattern to identify genuine error lines from stderr (everything else is treated as normal output) */
const STDERR_ERROR_PATTERN = /^(fatal|error|Error|ERROR|FATAL)[\s:]|Permission denied|ENOENT|EACCES|exited (?:with )?(?:code |status )?[1-9]|command not found|No such file|segmentation fault/i;

function classifyStderrLine(line: string): 'error' | 'output' {
  if (STDERR_ERROR_PATTERN.test(line) || CONTEXT_EXHAUSTION_PATTERN.test(line)) return 'error';
  return 'output';
}

export class LogStreamer {
  /** Accumulated token usage per task (todoId -> TokenUsage) */
  private tokenUsageMap: Map<string, TokenUsage> = new Map();
  /** Tracks whether context exhaustion was detected for a task */
  private contextExhaustedMap: Map<string, boolean> = new Map();
  /** Current round number per task (for multi-round "continue" feature) */
  private roundMap: Map<string, number> = new Map();
  /** Latest rate limit reset time (Unix epoch seconds), shared across all tasks */
  private _resetsAt: number | null = null;
  private _rateLimitUsedPct: number | null = null;

  /** Set the current round number for a task. Subsequent streamed logs will use this round. */
  setRound(todoId: string, roundNumber: number): void {
    this.roundMap.set(todoId, roundNumber);
  }

  private getRound(todoId: string): number {
    return this.roundMap.get(todoId) ?? 1;
  }

  /** Internal: create a task log tagged with the current round number. */
  private log(todoId: string, logType: string, message: string): ReturnType<typeof queries.createTaskLog> {
    return queries.createTaskLog(todoId, logType, message, this.getRound(todoId));
  }

  /**
   * Attach to a CLI process stdout/stderr and save logs to DB.
   * Used for Gemini/Codex (plain text output).
   * stdout -> log_type: 'output'
   * stderr -> log_type: 'error'
   * Also detects git commit messages in output -> log_type: 'commit'
   */
  streamToDb(todoId: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream): void {
    const commitPattern = /commit\s+[0-9a-f]{7,40}/i;

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
          if (commitPattern.test(line)) {
            this.log(todoId, 'commit', line.trim());
            const hashMatch = line.match(/[0-9a-f]{7,40}/i);
            broadcaster.broadcast({
              type: 'todo:commit',
              todoId,
              commitHash: hashMatch ? hashMatch[0] : '',
              message: line.trim(),
            });
          } else {
            this.log(todoId, 'output', line.trim());
            broadcaster.broadcast({
              type: 'todo:log',
              todoId,
              message: line.trim(),
              logType: 'output',
            });
          }
        } catch {
          // Todo may have been deleted — skip log but don't crash
        }
      }
    });

    stdout.on('end', () => {
      if (stdoutBuffer.trim()) {
        try {
          if (commitPattern.test(stdoutBuffer)) {
            this.log(todoId, 'commit', stdoutBuffer.trim());
            const hashMatch = stdoutBuffer.match(/[0-9a-f]{7,40}/i);
            broadcaster.broadcast({
              type: 'todo:commit',
              todoId,
              commitHash: hashMatch ? hashMatch[0] : '',
              message: stdoutBuffer.trim(),
            });
          } else {
            this.log(todoId, 'output', stdoutBuffer.trim());
            broadcaster.broadcast({
              type: 'todo:log',
              todoId,
              message: stdoutBuffer.trim(),
              logType: 'output',
            });
          }
        } catch {
          // Todo may have been deleted — skip log but don't crash
        }
      }
    });

    let stderrBuffer = '';
    stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        if (CONTEXT_EXHAUSTION_PATTERN.test(line)) {
          this.contextExhaustedMap.set(todoId, true);
        }
        const logType = classifyStderrLine(line.trim());
        try {
          this.log(todoId, logType, line.trim());
          broadcaster.broadcast({
            type: 'todo:log',
            todoId,
            message: line.trim(),
            logType,
          });
        } catch {
          // Todo may have been deleted — skip log but don't crash
        }
      }
    });

    stderr.on('end', () => {
      if (stderrBuffer.trim()) {
        if (CONTEXT_EXHAUSTION_PATTERN.test(stderrBuffer)) {
          this.contextExhaustedMap.set(todoId, true);
        }
        const logType = classifyStderrLine(stderrBuffer.trim());
        try {
          this.log(todoId, logType, stderrBuffer.trim());
          broadcaster.broadcast({
            type: 'todo:log',
            todoId,
            message: stderrBuffer.trim(),
            logType,
          });
        } catch {
          // Todo may have been deleted — skip log but don't crash
        }
      }
    });
  }

  /**
   * Attach to a Claude CLI process with stream-json output.
   * JSON lines may come via stdout or stderr depending on environment
   * (shell: true on Windows can redirect stderr to stdout).
   * Both streams are parsed as JSON lines.
   */
  streamJsonToDb(todoId: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream, verbose: boolean = false): void {
    const commitPattern = /commit\s+[0-9a-f]{7,40}/i;

    // Initialize token usage accumulator
    this.tokenUsageMap.set(todoId, {
      input_tokens: null, output_tokens: null,
      cache_read_input_tokens: null, cache_creation_input_tokens: null,
      total_cost: null, duration_ms: null, num_turns: null,
      context_window: null,
    });

    stdout.setEncoding('utf8' as BufferEncoding);
    stderr.setEncoding('utf8' as BufferEncoding);

    // Helper to wire up JSON line parsing on a stream
    const attachJsonParser = (stream: NodeJS.ReadableStream) => {
      let buffer = '';
      stream.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          this.processJsonLine(todoId, line.trim(), commitPattern, verbose);
        }
      });
      stream.on('end', () => {
        if (buffer.trim()) {
          this.processJsonLine(todoId, buffer.trim(), commitPattern, verbose);
        }
      });
    };

    attachJsonParser(stdout);
    attachJsonParser(stderr);
  }

  /**
   * Process a single JSON line from Claude CLI stream-json output.
   */
  private processJsonLine(todoId: string, line: string, commitPattern: RegExp, verbose: boolean = false): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      // Not valid JSON — log as raw error (fallback)
      if (CONTEXT_EXHAUSTION_PATTERN.test(line)) {
        this.contextExhaustedMap.set(todoId, true);
      }
      try {
        this.log(todoId, 'error', line);
        broadcaster.broadcast({ type: 'todo:log', todoId, message: line, logType: 'error' });
      } catch { /* ignore */ }
      return;
    }

    try {
      switch (event.type) {
        case 'assistant': {
          // Extract response text from message.content[]
          const message = event.message as Record<string, unknown> | undefined;
          const content = message?.content as Array<Record<string, unknown>> | undefined;
          if (content) {
            for (const block of content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                const text = block.text.trim();
                if (!text) break;

                // Detect commits within the text (emitted as separate commit logs)
                for (const line of text.split('\n')) {
                  if (commitPattern.test(line)) {
                    this.log(todoId, 'commit', line.trim());
                    const hashMatch = line.match(/[0-9a-f]{7,40}/i);
                    broadcaster.broadcast({
                      type: 'todo:commit',
                      todoId,
                      commitHash: hashMatch ? hashMatch[0] : '',
                      message: line.trim(),
                    });
                  }
                }
                // Store full text as a single assistant log entry
                this.log(todoId, 'assistant', text);
                broadcaster.broadcast({
                  type: 'todo:log',
                  todoId,
                  message: text,
                  logType: 'assistant',
                });
              } else if (block.type === 'tool_use') {
                // Store tool call as structured JSON
                const toolName = block.name as string || 'unknown';
                const input = block.input as Record<string, unknown> | undefined;
                const summary = this.extractToolSummary(toolName, input);
                const payload: Record<string, unknown> = { tool: toolName, summary };
                if (verbose && input) payload.input = input;
                const logMsg = JSON.stringify(payload);
                this.log(todoId, 'tool_use', logMsg);
                broadcaster.broadcast({ type: 'todo:log', todoId, message: logMsg, logType: 'tool_use' });
              } else if (verbose && block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                const logMsg = resultContent.length > 2000 ? resultContent.slice(0, 2000) + '...' : resultContent;
                this.log(todoId, 'tool_result', logMsg);
                broadcaster.broadcast({ type: 'todo:log', todoId, message: logMsg, logType: 'tool_result' });
              }
            }
          }
          break;
        }

        case 'error': {
          // Check for context exhaustion in error events
          const errorMsg = typeof event.error === 'string' ? event.error
            : typeof event.message === 'string' ? event.message
            : JSON.stringify(event);
          if (CONTEXT_EXHAUSTION_PATTERN.test(errorMsg)) {
            this.contextExhaustedMap.set(todoId, true);
          }
          try {
            this.log(todoId, 'error', errorMsg);
            broadcaster.broadcast({ type: 'todo:log', todoId, message: errorMsg, logType: 'error' });
          } catch { /* ignore */ }
          break;
        }

        case 'result': {
          // Check if result indicates an error related to context
          if (event.is_error) {
            const resultText = typeof event.result === 'string' ? event.result : '';
            if (CONTEXT_EXHAUSTION_PATTERN.test(resultText)) {
              this.contextExhaustedMap.set(todoId, true);
            }
          }
          // Extract token usage data
          const usage = this.tokenUsageMap.get(todoId);
          if (usage) {
            const apiUsage = event.usage as Record<string, unknown> | undefined;
            if (apiUsage) {
              usage.input_tokens = typeof apiUsage.input_tokens === 'number' ? apiUsage.input_tokens : null;
              usage.output_tokens = typeof apiUsage.output_tokens === 'number' ? apiUsage.output_tokens : null;
              usage.cache_read_input_tokens = typeof apiUsage.cache_read_input_tokens === 'number' ? apiUsage.cache_read_input_tokens : null;
              usage.cache_creation_input_tokens = typeof apiUsage.cache_creation_input_tokens === 'number' ? apiUsage.cache_creation_input_tokens : null;
            }
            usage.total_cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null;
            usage.duration_ms = typeof event.duration_ms === 'number' ? event.duration_ms : null;
            usage.num_turns = typeof event.num_turns === 'number' ? event.num_turns : null;

            // Extract contextWindow from modelUsage (first model entry)
            const modelUsage = event.modelUsage as Record<string, Record<string, unknown>> | undefined;
            if (modelUsage) {
              const firstModel = Object.values(modelUsage)[0];
              if (firstModel && typeof firstModel.contextWindow === 'number') {
                usage.context_window = firstModel.contextWindow;
              }
            }
          }
          break;
        }

        case 'rate_limit_event': {
          const info = event.rate_limit_info as Record<string, unknown> | undefined;
          if (info) {
            const resetsAt = typeof info.resetsAt === 'number' ? info.resetsAt : null;
            if (resetsAt) {
              this._resetsAt = resetsAt;
              broadcaster.broadcast({
                type: 'rate-limit:updated',
                resetsAt,
                status: typeof info.status === 'string' ? info.status : null,
              });
            }
          }
          break;
        }

        default:
          if (verbose) {
            const eventType = String(event.type || 'unknown');
            let logMsg: string;
            if (eventType === 'system') {
              const msg = typeof event.message === 'string' ? event.message : JSON.stringify(event);
              logMsg = `[System] ${msg}`;
            } else {
              const summary = JSON.stringify(event);
              logMsg = `[${eventType}] ${summary.length > 2000 ? summary.slice(0, 2000) + '...' : summary}`;
            }
            this.log(todoId, 'output', logMsg);
            broadcaster.broadcast({ type: 'todo:log', todoId, message: logMsg, logType: 'output' });
          }
          break;
      }
    } catch {
      // Parsing failure — ignore to keep streaming
    }
  }

  /** Extract a human-readable summary from tool input for compact display. */
  private extractToolSummary(toolName: string, input?: Record<string, unknown>): string {
    if (!input) return toolName;
    switch (toolName) {
      case 'Read': case 'Edit': case 'Write':
        return String(input.file_path || toolName);
      case 'Bash': {
        const cmd = String(input.command || '');
        return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
      }
      case 'Grep': {
        const pat = String(input.pattern || '');
        const path = input.path ? ` in ${input.path}` : '';
        return `/${pat}/${path}`;
      }
      case 'Glob':
        return String(input.pattern || toolName);
      default: {
        const first = Object.values(input).find(v => typeof v === 'string');
        return typeof first === 'string' ? (first.length > 60 ? first.slice(0, 60) + '...' : first) : toolName;
      }
    }
  }

  /** Get the latest known rate limit reset time (Unix epoch seconds). */
  getResetsAt(): number | null {
    return this._resetsAt;
  }

  /**
   * Fetch rate limit info by running a minimal Claude CLI call in the background.
   * Called once on server startup to populate resetsAt before any real task runs.
   */
  fetchRateLimitOnStartup(): void {
    if (this._resetsAt) return; // already known
    try {
      const proc = spawn(
        process.platform === 'win32' ? 'cmd.exe' : 'claude',
        process.platform === 'win32'
          ? ['/c', 'claude', '--print', '--verbose', '--output-format', 'stream-json', '-p', 'respond with ok']
          : ['--print', '--verbose', '--output-format', 'stream-json', '-p', 'respond with ok'],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env }, cwd: process.env.HOME || process.env.USERPROFILE || '.' },
      );
      let buffer = '';
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line.trim());
            if (event.type === 'rate_limit_event' && event.rate_limit_info?.resetsAt) {
              this._resetsAt = event.rate_limit_info.resetsAt;
              broadcaster.broadcast({
                type: 'rate-limit:updated',
                resetsAt: this._resetsAt!,
                status: event.rate_limit_info.status ?? null,
              });
              console.log(`Rate limit info fetched: resets at ${new Date(this._resetsAt! * 1000).toLocaleString()}`);
            }
          } catch { /* not JSON, skip */ }
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', () => { /* claude not installed — ignore */ });
    } catch { /* spawn failed — ignore */ }
  }

  /**
   * Check if context exhaustion was detected for a task. Consumes the flag.
   */
  isContextExhausted(todoId: string): boolean {
    const exhausted = this.contextExhaustedMap.get(todoId) ?? false;
    this.contextExhaustedMap.delete(todoId);
    return exhausted;
  }

  /**
   * Get accumulated token usage for a task and clean up.
   */
  getTokenUsage(todoId: string): TokenUsage | null {
    const usage = this.tokenUsageMap.get(todoId);
    if (!usage) return null;
    this.tokenUsageMap.delete(todoId);
    this.contextExhaustedMap.delete(todoId);
    // Return null if nothing was parsed
    if (usage.input_tokens === null && usage.output_tokens === null && usage.total_cost === null) {
      return null;
    }
    return usage;
  }
}

export const logStreamer = new LogStreamer();
