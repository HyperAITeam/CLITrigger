import * as queries from '../db/queries.js';
import { broadcaster } from '../websocket/broadcaster.js';

export interface TokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost: number | null;
}

/**
 * Parse token usage from a single line of CLI output.
 * Handles various Claude CLI output formats:
 *   - "Total input tokens: 12,345"
 *   - "Input tokens: 12345"
 *   - "input: 12.3k tokens"
 *   - "Tokens: 109k input, 2.7k output ($0.37)"
 *   - "Total cost: $0.05"
 *   - "Cost: $0.1234 (input: 12345 tokens, output: 6789 tokens)"
 */
function parseTokenNumber(s: string): number | null {
  // Handle "12.3k" -> 12300, "1.5M" -> 1500000
  const kMatch = s.match(/([\d,.]+)\s*k/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1].replace(/,/g, '')) * 1000);
  const mMatch = s.match(/([\d,.]+)\s*M/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1].replace(/,/g, '')) * 1000000);
  const numMatch = s.match(/([\d,]+)/);
  if (numMatch) return parseInt(numMatch[1].replace(/,/g, ''), 10);
  return null;
}

function parseCost(s: string): number | null {
  const match = s.match(/\$\s*([\d,.]+)/);
  if (match) return parseFloat(match[1].replace(/,/g, ''));
  return null;
}

export function parseTokenLine(line: string, current: TokenUsage): boolean {
  let matched = false;

  // "Tokens: 109k input, 2.7k output ($0.37)" or "Tokens: 109k input, 2.7k output"
  const compactMatch = line.match(/tokens?\s*:\s*([\d,.]+\s*[kKmM]?)\s*input\s*,\s*([\d,.]+\s*[kKmM]?)\s*output/i);
  if (compactMatch) {
    current.input_tokens = parseTokenNumber(compactMatch[1]) ?? current.input_tokens;
    current.output_tokens = parseTokenNumber(compactMatch[2]) ?? current.output_tokens;
    matched = true;
  }

  // "Input tokens: 12,345" or "Total input tokens: 12345" or "input: 12.3k tokens"
  if (!compactMatch) {
    const inputMatch = line.match(/input\s*(?:tokens)?\s*:\s*([\d,.]+\s*[kKmM]?)/i) ||
                       line.match(/([\d,.]+\s*[kKmM]?)\s*input\s*token/i);
    if (inputMatch) {
      current.input_tokens = parseTokenNumber(inputMatch[1]) ?? current.input_tokens;
      matched = true;
    }

    const outputMatch = line.match(/output\s*(?:tokens)?\s*:\s*([\d,.]+\s*[kKmM]?)/i) ||
                        line.match(/([\d,.]+\s*[kKmM]?)\s*output\s*token/i);
    if (outputMatch) {
      current.output_tokens = parseTokenNumber(outputMatch[1]) ?? current.output_tokens;
      matched = true;
    }
  }

  // "$0.37" or "cost: $0.05" or "Total cost: $0.1234"
  const costMatch = line.match(/(?:cost|total)\s*.*?\$\s*([\d,.]+)/i) ||
                    line.match(/\(\s*\$\s*([\d,.]+)\s*\)/);
  if (costMatch) {
    current.total_cost = parseCost('$' + costMatch[1]) ?? current.total_cost;
    matched = true;
  }

  return matched;
}

export class LogStreamer {
  /** Accumulated token usage per task (todoId -> TokenUsage) */
  private tokenUsageMap: Map<string, TokenUsage> = new Map();

  /**
   * Attach to a Claude process stdout/stderr and save logs to DB.
   * stdout -> log_type: 'output'
   * stderr -> log_type: 'error'
   * Also detects git commit messages in output -> log_type: 'commit'
   */
  streamToDb(todoId: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream): void {
    const commitPattern = /commit\s+[0-9a-f]{7,40}/i;

    // Initialize token usage accumulator for this task
    this.tokenUsageMap.set(todoId, { input_tokens: null, output_tokens: null, total_cost: null });

    stdout.setEncoding('utf8' as BufferEncoding);
    stderr.setEncoding('utf8' as BufferEncoding);

    let stdoutBuffer = '';
    stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      // Keep the last incomplete line in the buffer
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        // Try to parse token usage from output
        const usage = this.tokenUsageMap.get(todoId);
        if (usage) parseTokenLine(line, usage);

        try {
          // Detect git commit messages
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
      // Flush remaining buffer
      if (stdoutBuffer.trim()) {
        const usage = this.tokenUsageMap.get(todoId);
        if (usage) parseTokenLine(stdoutBuffer, usage);

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

        // Try to parse token usage from stderr (Claude CLI outputs stats here)
        const usage = this.tokenUsageMap.get(todoId);
        if (usage) parseTokenLine(line, usage);

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
        const usage = this.tokenUsageMap.get(todoId);
        if (usage) parseTokenLine(stderrBuffer, usage);

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
