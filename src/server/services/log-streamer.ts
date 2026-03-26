import * as queries from '../db/queries.js';
import { broadcaster } from '../websocket/broadcaster.js';

export class LogStreamer {
  /**
   * Attach to a Claude process stdout/stderr and save logs to DB.
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
      // Keep the last incomplete line in the buffer
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

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
}

export const logStreamer = new LogStreamer();
