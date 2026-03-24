import * as queries from '../db/queries.js';

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

        // Detect git commit messages
        if (commitPattern.test(line)) {
          queries.createTaskLog(todoId, 'commit', line.trim());
        } else {
          queries.createTaskLog(todoId, 'output', line.trim());
        }
      }
    });

    stdout.on('end', () => {
      // Flush remaining buffer
      if (stdoutBuffer.trim()) {
        if (commitPattern.test(stdoutBuffer)) {
          queries.createTaskLog(todoId, 'commit', stdoutBuffer.trim());
        } else {
          queries.createTaskLog(todoId, 'output', stdoutBuffer.trim());
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
        queries.createTaskLog(todoId, 'error', line.trim());
      }
    });

    stderr.on('end', () => {
      if (stderrBuffer.trim()) {
        queries.createTaskLog(todoId, 'error', stderrBuffer.trim());
      }
    });
  }
}

export const logStreamer = new LogStreamer();
