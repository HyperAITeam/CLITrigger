import { execFile } from 'child_process';

export interface CliToolStatus {
  tool: string;
  installed: boolean;
  version: string | null;
}

interface CacheEntry {
  status: CliToolStatus;
  timestamp: number;
}

const CACHE_TTL = 60_000; // 60 seconds
const CHECK_TIMEOUT = 5_000; // 5 seconds
const cache = new Map<string, CacheEntry>();

const TOOLS = [
  { tool: 'claude', command: 'claude' },
  { tool: 'gemini', command: 'gemini' },
  { tool: 'codex', command: 'codex' },
] as const;

function checkTool(tool: string, command: string): Promise<CliToolStatus> {
  return new Promise((resolve) => {
    const opts: { timeout: number; shell?: boolean } = { timeout: CHECK_TIMEOUT };
    // Windows needs shell:true to resolve .cmd shims (claude.cmd, gemini.cmd, etc.)
    if (process.platform === 'win32') opts.shell = true;

    execFile(command, ['--version'], opts, (error, stdout) => {
      if (error) {
        resolve({ tool, installed: false, version: null });
        return;
      }
      // Parse version from stdout (first line, trim whitespace)
      const version = stdout.trim().split('\n')[0].trim() || null;
      resolve({ tool, installed: true, version });
    });
  });
}

export async function checkAllTools(): Promise<CliToolStatus[]> {
  const now = Date.now();
  const needsCheck: typeof TOOLS[number][] = [];
  const results: CliToolStatus[] = [];

  for (const t of TOOLS) {
    const cached = cache.get(t.tool);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      results.push(cached.status);
    } else {
      needsCheck.push(t);
    }
  }

  if (needsCheck.length > 0) {
    const checked = await Promise.all(
      needsCheck.map((t) => checkTool(t.tool, t.command))
    );
    for (const status of checked) {
      cache.set(status.tool, { status, timestamp: now });
      results.push(status);
    }
  }

  // Return in consistent order
  return TOOLS.map((t) => results.find((r) => r.tool === t.tool)!);
}

export function clearCache(): void {
  cache.clear();
}
