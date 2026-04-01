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

export class LogStreamer {
  /** Accumulated token usage per task (todoId -> TokenUsage) */
  private tokenUsageMap: Map<string, TokenUsage> = new Map();

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
            queries.createTaskLog(todoId, 'commit', line.trim());
            const hashMatch = line.match(/[0-9a-f]{7,40}/i);
            broadcaster.broadcast({
              type: 'todo:commit',
              todoId,
              commitHash: hashMatch ? hashMatch[0] : '',
              message: line.trim(),
            });
          } else {
            queries.createTaskLog(todoId, 'output', line.trim());
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
            queries.createTaskLog(todoId, 'commit', stdoutBuffer.trim());
            const hashMatch = stdoutBuffer.match(/[0-9a-f]{7,40}/i);
            broadcaster.broadcast({
              type: 'todo:commit',
              todoId,
              commitHash: hashMatch ? hashMatch[0] : '',
              message: stdoutBuffer.trim(),
            });
          } else {
            queries.createTaskLog(todoId, 'output', stdoutBuffer.trim());
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
        try {
          queries.createTaskLog(todoId, 'error', line.trim());
          broadcaster.broadcast({
            type: 'todo:log',
            todoId,
            message: line.trim(),
            logType: 'error',
          });
        } catch {
          // Todo may have been deleted — skip log but don't crash
        }
      }
    });

    stderr.on('end', () => {
      if (stderrBuffer.trim()) {
        try {
          queries.createTaskLog(todoId, 'error', stderrBuffer.trim());
          broadcaster.broadcast({
            type: 'todo:log',
            todoId,
            message: stderrBuffer.trim(),
            logType: 'error',
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
      try {
        queries.createTaskLog(todoId, 'error', line);
        broadcaster.broadcast({ type: 'todo:log', todoId, message: line, logType: 'error' });
      } catch { /* ignore */ }
      return;
    }

    try {
      switch (event.type) {
        case 'assistant': {
          // Extract response text from message.content[0].text
          const message = event.message as Record<string, unknown> | undefined;
          const content = message?.content as Array<Record<string, unknown>> | undefined;
          if (content) {
            for (const block of content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                const text = block.text.trim();
                if (!text) break;

                // Split into lines for commit detection and readable logging
                const textLines = text.split('\n');
                for (const textLine of textLines) {
                  if (!textLine.trim()) continue;
                  if (commitPattern.test(textLine)) {
                    queries.createTaskLog(todoId, 'commit', textLine.trim());
                    const hashMatch = textLine.match(/[0-9a-f]{7,40}/i);
                    broadcaster.broadcast({
                      type: 'todo:commit',
                      todoId,
                      commitHash: hashMatch ? hashMatch[0] : '',
                      message: textLine.trim(),
                    });
                  } else {
                    queries.createTaskLog(todoId, 'output', textLine.trim());
                    broadcaster.broadcast({
                      type: 'todo:log',
                      todoId,
                      message: textLine.trim(),
                      logType: 'output',
                    });
                  }
                }
              } else if (block.type === 'tool_use') {
                // Log tool usage for visibility
                const toolName = block.name as string || 'unknown';
                let logMsg = `[Tool: ${toolName}]`;
                if (verbose && block.input) {
                  const inputStr = JSON.stringify(block.input, null, 2);
                  logMsg += ` input: ${inputStr.length > 2000 ? inputStr.slice(0, 2000) + '...' : inputStr}`;
                }
                queries.createTaskLog(todoId, 'output', logMsg);
                broadcaster.broadcast({ type: 'todo:log', todoId, message: logMsg, logType: 'output' });
              } else if (verbose && block.type === 'tool_result') {
                const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                const logMsg = `[Result] ${content.length > 2000 ? content.slice(0, 2000) + '...' : content}`;
                queries.createTaskLog(todoId, 'output', logMsg);
                broadcaster.broadcast({ type: 'todo:log', todoId, message: logMsg, logType: 'output' });
              }
            }
          }
          break;
        }

        case 'result': {
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
            queries.createTaskLog(todoId, 'output', logMsg);
            broadcaster.broadcast({ type: 'todo:log', todoId, message: logMsg, logType: 'output' });
          }
          break;
      }
    } catch {
      // Parsing failure — ignore to keep streaming
    }
  }

  /**
   * Get accumulated token usage for a task and clean up.
   */
  getTokenUsage(todoId: string): TokenUsage | null {
    const usage = this.tokenUsageMap.get(todoId);
    if (!usage) return null;
    this.tokenUsageMap.delete(todoId);
    // Return null if nothing was parsed
    if (usage.input_tokens === null && usage.output_tokens === null && usage.total_cost === null) {
      return null;
    }
    return usage;
  }
}

export const logStreamer = new LogStreamer();
