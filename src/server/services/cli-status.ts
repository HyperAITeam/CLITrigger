import { execFile } from 'child_process';
import { maybeTriggerSync } from './model-sync.js';
import type { CliTool } from './cli-adapters.js';
import { getRawShellInfo } from './cli-adapters.js';
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
  { tool: 'antigravity', command: 'agy' },
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
    // Windows needs shell:true to resolve .cmd shims (claude.cmd, agy.cmd, etc.)
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

/**
 * Cached single-tool probe for pre-flight checks before spawning a CLI.
 * On Windows spawn uses shell:true, so a missing binary never fires ENOENT —
 * cmd.exe just exits 1 with a localized "not recognized" message. Probing
 * first turns that into an actionable error. Returns null for tools without
 * an installation probe (e.g. raw-shell).
 */
export async function getToolStatus(tool: string): Promise<CliToolStatus | null> {
  const entry = TOOLS.find((t) => t.tool === tool);
  if (!entry) return null;
  const cached = cache.get(tool);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.status;
  const status = await checkTool(entry.tool, entry.command, false);
  cache.set(tool, { status, timestamp: Date.now() });
  return status;
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
  const ordered = order.map((tool) => results.find((r) => r.tool === tool)!);
  // raw-shell is always available; report the resolved shell name so the UI
  // can label it "Raw Shell (PowerShell)" etc. No process is spawned.
  ordered.push({ tool: 'raw-shell', installed: true, version: getRawShellInfo().name });
  return ordered;
}

export function clearCache(): void {
  cache.clear();
}
