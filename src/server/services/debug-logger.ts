import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';

const DEBUG_DIR = '.debug-logs';

export interface DebugSession {
  writeStdin(content: string): void;
  teeStdout(original: NodeJS.ReadableStream): NodeJS.ReadableStream;
  teeStderr(original: NodeJS.ReadableStream): NodeJS.ReadableStream;
  finalize(exitCode: number): void;
  readonly filePath: string;
}

export interface DebugLogFile {
  name: string;
  todoId: string;
  timestamp: string;
  size: number;
}

class DebugLogger {
  private getDebugDir(projectPath: string): string {
    return path.join(projectPath, DEBUG_DIR);
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  startSession(opts: {
    todoId: string;
    projectPath: string;
    cliTool: string;
    command: string;
    args: string[];
    workDir: string;
    model?: string;
    sandboxMode?: string;
  }): DebugSession {
    const debugDir = this.getDebugDir(opts.projectPath);
    this.ensureDir(debugDir);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${opts.todoId}_${ts}.log`;
    const filePath = path.join(debugDir, filename);
    const startTime = Date.now();

    // Write header
    const header = [
      '========================================',
      'CLITrigger Debug Log',
      '========================================',
      `Task ID:    ${opts.todoId}`,
      `Timestamp:  ${new Date().toISOString()}`,
      `CLI Tool:   ${opts.cliTool}`,
      `Command:    ${opts.command} ${opts.args.join(' ')}`,
      `Work Dir:   ${opts.workDir}`,
      `Model:      ${opts.model || '(default)'}`,
      `Sandbox:    ${opts.sandboxMode || 'N/A'}`,
      '',
    ].join('\n');
    fs.writeFileSync(filePath, header, 'utf-8');

    let stdoutHeaderWritten = false;
    let stderrHeaderWritten = false;

    const session: DebugSession = {
      filePath,

      writeStdin(content: string) {
        fs.appendFileSync(filePath, `\n======== STDIN/PROMPT ========\n${content}\n`, 'utf-8');
      },

      teeStdout(original: NodeJS.ReadableStream): NodeJS.ReadableStream {
        const passthrough = new PassThrough();
        original.on('data', (chunk: Buffer | string) => {
          if (!stdoutHeaderWritten) {
            fs.appendFileSync(filePath, '\n======== STDOUT ========\n', 'utf-8');
            stdoutHeaderWritten = true;
          }
          try { fs.appendFileSync(filePath, chunk); } catch { /* ignore write errors */ }
          passthrough.push(chunk);
        });
        original.on('end', () => passthrough.push(null));
        original.on('error', (err) => passthrough.destroy(err));
        return passthrough;
      },

      teeStderr(original: NodeJS.ReadableStream): NodeJS.ReadableStream {
        const passthrough = new PassThrough();
        original.on('data', (chunk: Buffer | string) => {
          if (!stderrHeaderWritten) {
            fs.appendFileSync(filePath, '\n======== STDERR ========\n', 'utf-8');
            stderrHeaderWritten = true;
          }
          try { fs.appendFileSync(filePath, chunk); } catch { /* ignore write errors */ }
          passthrough.push(chunk);
        });
        original.on('end', () => passthrough.push(null));
        original.on('error', (err) => passthrough.destroy(err));
        return passthrough;
      },

      finalize(exitCode: number) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const footer = [
          '',
          '======== EXIT ========',
          `Exit Code:  ${exitCode}`,
          `Duration:   ${duration}s`,
          `Finished:   ${new Date().toISOString()}`,
          '========================================',
          '',
        ].join('\n');
        try { fs.appendFileSync(filePath, footer, 'utf-8'); } catch { /* ignore */ }
      },
    };

    return session;
  }

  listLogs(projectPath: string, todoId?: string): DebugLogFile[] {
    const debugDir = this.getDebugDir(projectPath);
    if (!fs.existsSync(debugDir)) return [];

    const files = fs.readdirSync(debugDir)
      .filter(f => f.endsWith('.log'))
      .map(name => {
        const stat = fs.statSync(path.join(debugDir, name));
        // Parse todoId from filename: {todoId}_{timestamp}.log
        const underscoreIdx = name.indexOf('_');
        const fileTodoId = underscoreIdx > 0 ? name.slice(0, underscoreIdx) : name;
        return {
          name,
          todoId: fileTodoId,
          timestamp: stat.mtime.toISOString(),
          size: stat.size,
        };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (todoId) {
      return files.filter(f => f.todoId === todoId);
    }
    return files;
  }

  readLog(projectPath: string, filename: string): string | null {
    const safeName = path.basename(filename);
    const filePath = path.join(this.getDebugDir(projectPath), safeName);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  deleteLog(projectPath: string, filename: string): boolean {
    const safeName = path.basename(filename);
    const filePath = path.join(this.getDebugDir(projectPath), safeName);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  deleteAllLogs(projectPath: string): number {
    const debugDir = this.getDebugDir(projectPath);
    if (!fs.existsSync(debugDir)) return 0;
    const files = fs.readdirSync(debugDir).filter(f => f.endsWith('.log'));
    for (const f of files) {
      try { fs.unlinkSync(path.join(debugDir, f)); } catch { /* ignore */ }
    }
    return files.length;
  }

  cleanupOldLogs(projectPath: string, retentionDays: number): number {
    const debugDir = this.getDebugDir(projectPath);
    if (!fs.existsSync(debugDir)) return 0;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const f of fs.readdirSync(debugDir).filter(n => n.endsWith('.log'))) {
      try {
        const stat = fs.statSync(path.join(debugDir, f));
        if (stat.mtime.getTime() < cutoff) {
          fs.unlinkSync(path.join(debugDir, f));
          cleaned++;
        }
      } catch { /* ignore */ }
    }
    return cleaned;
  }
}

export const debugLogger = new DebugLogger();
