import fs from 'fs';
import type { WebSocket } from 'ws';
import { broadcaster } from '../websocket/broadcaster.js';
import { getProjectById } from '../db/queries.js';
import { DEFAULT_EXCLUDES } from './file-scanner.js';

// Throttle window for change broadcasts. Clients rescan the whole tree on
// each event, so one coalesced event per window is enough.
const BROADCAST_DELAY_MS = 500;

interface WatchEntry {
  watcher: fs.FSWatcher;
  clients: Set<WebSocket>;
  timer: NodeJS.Timeout | null;
}

// Watches project roots and broadcasts a coalesced change event. Two
// instances exist: `vaultWatcher` (docs tab) and `gitWatcher` (git UIs) —
// same fs.watch/refcount machinery, different event type and path filter.
// A project is only watched while at least one client subscribed
// (`vault:watch`/`git:watch` WS messages), so the idle cost is zero.
class FsChangeWatcher {
  private entries = new Map<string, WatchEntry>();

  constructor(
    private eventType: 'vault:changed' | 'git:changed',
    // Path filter over the change's relative path segments.
    private accepts: (parts: string[]) => boolean,
  ) {}

  /** Start watching a project's root for this client. Silently no-ops when
   *  the project is unknown or fs.watch fails (e.g. inotify limits on large
   *  Linux trees) — the UI then degrades to manual refresh. */
  watch(projectId: string, ws: WebSocket): void {
    let entry = this.entries.get(projectId);
    if (!entry) {
      const project = getProjectById(projectId);
      if (!project) return;
      let watcher: fs.FSWatcher;
      try {
        watcher = fs.watch(project.path, { recursive: true }, (_event, filename) => {
          this.onChange(projectId, filename);
        });
      } catch {
        return;
      }
      watcher.on('error', () => this.dispose(projectId));
      entry = { watcher, clients: new Set(), timer: null };
      this.entries.set(projectId, entry);
    }
    entry.clients.add(ws);
  }

  unwatch(projectId: string, ws: WebSocket): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    entry.clients.delete(ws);
    if (entry.clients.size === 0) this.dispose(projectId);
  }

  /** Drop a disconnected client from every watch it held. */
  removeClient(ws: WebSocket): void {
    for (const [projectId, entry] of this.entries) {
      entry.clients.delete(ws);
      if (entry.clients.size === 0) this.dispose(projectId);
    }
  }

  private dispose(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    this.entries.delete(projectId);
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.watcher.close();
    } catch { /* already closed */ }
  }

  private onChange(projectId: string, filename: string | Buffer | null): void {
    if (filename) {
      const parts = filename.toString().split(/[\\/]/);
      if (!this.accepts(parts)) return;
    }
    const entry = this.entries.get(projectId);
    if (!entry || entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      broadcaster.broadcast({ type: this.eventType, projectId });
    }, BROADCAST_DELAY_MS);
  }
}

// Skip churn in build/VCS directories (npm install, git operations, …).
// ponytail: coarse segment filter only — .vaultignore'd paths still count
// as changes because the explorer shows them as hidden entries.
export const vaultWatcher = new FsChangeWatcher(
  'vault:changed',
  (parts) => !parts.some((part) => DEFAULT_EXCLUDES.includes(part)),
);

// Git filter: unlike vault, `.worktrees` counts (session worktrees are
// exactly what the git UIs show) and `.git` is limited to ref/state moves.
// `.git/index` MUST stay excluded: reading status can itself rewrite the
// index (racily-clean refresh), so including it would loop
// fetch → event → fetch. Staging-only changes (`git add` with no commit)
// therefore don't fire — the commit that follows does.
const GIT_EXCLUDES = DEFAULT_EXCLUDES.filter((d) => d !== '.worktrees' && d !== '.git');
const GIT_STATE_FILES = new Set(['HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD']);

export function gitWatchAccepts(parts: string[]): boolean {
  if (parts[0] === '.git') {
    return GIT_STATE_FILES.has(parts[parts.length - 1]) || parts.includes('refs');
  }
  return !parts.some((part) => GIT_EXCLUDES.includes(part));
}

export const gitWatcher = new FsChangeWatcher('git:changed', gitWatchAccepts);
