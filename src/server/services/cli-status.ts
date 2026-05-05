import { execFile } from 'child_process';
import { maybeTriggerSync } from './model-sync.js';
import type { CliTool } from './cli-adapters.js';
import { getDatabase } from '../db/connection.js';

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

// VCS tools listed alongside AI CLIs but skip model-sync — they're not
// model-bearing CLIs, just installation probes for UI guidance.
const VCS_TOOLS = [
  { tool: 'svn', command: 'svn' },
] as const;

function checkTool(tool: string, command: string, isVcs = false): Promise<CliToolStatus> {
  return new Promise((resolve) => {
    const opts: { timeout: number; shell?: boolean } = { timeout: CHECK_TIMEOUT };
    // Windows needs shell:true to resolve .cmd shims (claude.cmd, gemini.cmd, etc.)
    if (process.platform === 'win32') opts.shell = true;

    execFile(command, ['--version'], opts, async (error, stdout) => {
      if (error) {
        resolve({ tool, installed: false, version: null });
        return;
      }
      // Parse version from stdout (first line, trim whitespace)
      const version = stdout.trim().split('\n')[0].trim() || null;
      if (!isVcs) {
        // Await model reconciliation so clients that read /api/models right
        // after this request see the post-sync cli_models state.
        await maybeTriggerSync(tool as CliTool, version);
      }
      resolve({ tool, installed: true, version });
    });
  });
}

/**
 * VCS tools are only probed when at least one project explicitly opted in.
 * This keeps "no SVN here" installs free of stray svn process spawns and
 * the svn entry out of the API response.
 */
function svnRequested(): boolean {
  try {
    const row = getDatabase()
      .prepare('SELECT 1 FROM projects WHERE svn_enabled = 1 LIMIT 1')
      .get();
    return !!row;
  } catch {
    return false;
  }
}

export async function checkAllTools(): Promise<CliToolStatus[]> {
  const now = Date.now();
  const aiNeeds: typeof TOOLS[number][] = [];
  const vcsNeeds: typeof VCS_TOOLS[number][] = [];
  const results: CliToolStatus[] = [];
  const includeSvn = svnRequested();

  for (const t of TOOLS) {
    const cached = cache.get(t.tool);
    if (cached && now - cached.timestamp < CACHE_TTL) results.push(cached.status);
    else aiNeeds.push(t);
  }
  if (includeSvn) {
    for (const t of VCS_TOOLS) {
      const cached = cache.get(t.tool);
      if (cached && now - cached.timestamp < CACHE_TTL) results.push(cached.status);
      else vcsNeeds.push(t);
    }
  }

  const checked = await Promise.all([
    ...aiNeeds.map((t) => checkTool(t.tool, t.command, false)),
    ...vcsNeeds.map((t) => checkTool(t.tool, t.command, true)),
  ]);
  for (const status of checked) {
    cache.set(status.tool, { status, timestamp: now });
    results.push(status);
  }

  // Return in consistent order: AI tools first, then VCS tools (when included)
  const order = [
    ...TOOLS.map((t) => t.tool),
    ...(includeSvn ? VCS_TOOLS.map((t) => t.tool) : []),
  ];
  return order.map((tool) => results.find((r) => r.tool === tool)!);
}

export function clearCache(): void {
  cache.clear();
}
