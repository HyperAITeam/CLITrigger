// Plan usage (5-hour / weekly windows) for the CLIs that expose it locally.
// Claude: the same OAuth usage endpoint Claude Code's /usage reads.
// Codex: the last `rate_limits` snapshot Codex wrote into its session log —
// only as fresh as the last Codex run, hence `updatedAt`.
// ponytail: Antigravity has no known local usage source yet; macOS Claude
// credentials live in the Keychain, not .credentials.json — both return null.

import fs from 'fs';
import os from 'os';
import path from 'path';

export interface UsageWindow { percent: number; resetsAt: number /* unix seconds */ }
export interface CliUsage { fiveHour: UsageWindow | null; weekly: UsageWindow | null; updatedAt: number /* ms */ }
export interface UsageSnapshot { claude: CliUsage | null; codex: CliUsage | null }

const CACHE_TTL_MS = 5 * 60_000;
// Refresh button / panel switches skip the 5-min TTL but not this floor,
// so rapid clicking can't hammer the rate-limited Claude endpoint.
const FORCE_FLOOR_MS = 30_000;
let cache: { at: number; value: Promise<UsageSnapshot> } | null = null;
// The usage endpoint 429s often (statusline plugins poll it every minute);
// keep showing the last good reading — `updatedAt` tells the user its age.
let lastClaude: CliUsage | null = null;

export function getCliUsage(force = false): Promise<UsageSnapshot> {
  if (!cache || Date.now() - cache.at > (force ? FORCE_FLOOR_MS : CACHE_TTL_MS)) {
    cache = {
      at: Date.now(),
      value: Promise.all([
        readClaude().then(fresh => (lastClaude = fresh ?? lastClaude), () => lastClaude),
        Promise.resolve().then(readCodex).catch(() => null),
      ])
        .then(([claude, codex]) => ({ claude, codex })),
    };
  }
  return cache.value;
}

function claudeWindow(raw: { utilization?: number; resets_at?: string } | null | undefined): UsageWindow | null {
  if (typeof raw?.utilization !== 'number' || !raw.resets_at) return null;
  return { percent: Math.round(raw.utilization), resetsAt: Math.floor(Date.parse(raw.resets_at) / 1000) };
}

async function readClaude(): Promise<CliUsage | null> {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const credentials = JSON.parse(fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8'));
  const oauth = credentials.claudeAiOauth;
  // Expired token: Claude Code refreshes it on its next run; don't refresh it ourselves.
  if (!oauth?.accessToken || (oauth.expiresAt != null && oauth.expiresAt <= Date.now())) return null;
  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return { fiveHour: claudeWindow(data.five_hour), weekly: claudeWindow(data.seven_day), updatedAt: Date.now() };
}

function codexWindow(raw: { used_percent?: number; resets_at?: number } | null | undefined): UsageWindow | null {
  if (typeof raw?.used_percent !== 'number' || typeof raw.resets_at !== 'number') return null;
  return { percent: Math.round(raw.used_percent), resetsAt: raw.resets_at };
}

function newestChild(directory: string, filter: (name: string) => boolean): string | null {
  const names = fs.readdirSync(directory).filter(filter).sort();
  return names.length ? path.join(directory, names[names.length - 1]) : null;
}

function readCodex(): CliUsage | null {
  // sessions/YYYY/MM/DD/rollout-*.jsonl — newest day dir, newest file in it.
  // ponytail: a session started on an earlier day but still running is missed
  // until a newer-day session exists; scan more day dirs if that matters.
  let directory = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  for (let depth = 0; depth < 3; depth++) {
    const next = newestChild(directory, name => /^\d+$/.test(name));
    if (!next) return null;
    directory = next;
  }
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.jsonl'))
    .map(name => path.join(directory, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return null;

  // Rollouts grow to many MB; the latest token_count event is near the end.
  const handle = fs.openSync(files[0], 'r');
  try {
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, 512 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits":{')) continue;
      let event;
      try { event = JSON.parse(lines[i]); } catch { continue; } // first line may be cut mid-way
      const limits = event.payload?.rate_limits;
      if (!limits) continue;
      return {
        fiveHour: codexWindow(limits.primary),
        weekly: codexWindow(limits.secondary),
        updatedAt: Date.parse(event.timestamp) || Date.now(),
      };
    }
  } finally {
    fs.closeSync(handle);
  }
  return null;
}
