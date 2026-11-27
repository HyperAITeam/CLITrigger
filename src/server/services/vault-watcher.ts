import fs from 'fs';
import path from 'path';
import type { WebSocket } from 'ws';
import { broadcaster } from '../websocket/broadcaster.js';
import { getProjectById, type Project } from '../db/queries.js';
import { DEFAULT_EXCLUDES, invalidateVaultRoot, setVaultRootWatched, touchesVaultDir } from './file-scanner.js';
import { parseVaultLinks } from './vault-roots.js';

// Throttle window for change broadcasts. Clients rescan the whole tree on
// each event, so one coalesced event per window is enough.
const BROADCAST_DELAY_MS = 500;

interface WatchEntry {
  watchers: fs.FSWatcher[];
  roots: string[]; // roots actually being watched
  clients: Set<WebSocket>;
  timer: NodeJS.Timeout | null;
}

interface WatchHooks {
  opened(roots: string[]): void;
  closed(roots: string[]): void;
  /** An accepted change under `root`, before broadcast throttling. */
  changed(root: string, filename: string | null): void;
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
    // Folders to watch; the first is the project root.
    private roots: (project: Project) => string[] = (project) => [project.path],
    private hooks?: WatchHooks,
  ) {}

  /** Start watching a project's root for this client. Silently no-ops when
   *  the project is unknown or fs.watch fails (e.g. inotify limits on large
   *  Linux trees) — the UI then degrades to manual refresh. */
  watch(projectId: string, ws: WebSocket): void {
    let entry = this.entries.get(projectId);
    if (!entry) {
      const opened = this.openWatchers(projectId);
      if (!opened) return;
      entry = { ...opened, clients: new Set(), timer: null };
      this.entries.set(projectId, entry);
    }
    entry.clients.add(ws);
  }

  /** Re-read the project's roots for current subscribers (linked folders changed). */
  refresh(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    this.closeWatchers(entry);
    const opened = this.openWatchers(projectId);
    if (opened) Object.assign(entry, opened);
    else this.dispose(projectId);
  }

  // Null when the project is unknown or its root can't be watched; other
  // roots (linked folders on an unplugged drive) are skipped.
  private openWatchers(projectId: string): { watchers: fs.FSWatcher[]; roots: string[] } | null {
    const project = getProjectById(projectId);
    if (!project) return null;
    const watchers: fs.FSWatcher[] = [];
    const roots: string[] = [];
    for (const [i, root] of this.roots(project).entries()) {
      let watcher: fs.FSWatcher;
      try {
        watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
          this.onChange(projectId, root, filename);
        });
      } catch {
        if (i === 0) return null;
        continue;
      }
      watcher.on('error', () => this.dispose(projectId));
      watchers.push(watcher);
      roots.push(root);
    }
    this.hooks?.opened(roots);
    return { watchers, roots };
  }

  private closeWatchers(entry: WatchEntry): void {
    for (const watcher of entry.watchers) {
      try {
        watcher.close();
      } catch { /* already closed */ }
    }
    this.hooks?.closed(entry.roots);
    entry.watchers = [];
    entry.roots = [];
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
    this.closeWatchers(entry);
  }

  private onChange(projectId: string, root: string, filename: string | Buffer | null): void {
    const name = filename ? filename.toString() : null;
    if (name) {
      const parts = name.split(/[\\/]/);
      if (!this.accepts(parts)) return;
    }
    this.hooks?.changed(root, name);
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
// Only docs, .vaultignore and (extension-less) directories can change a scan
// result; build churn (.obj, .uasset, Library/…) must not drop the scan cache.
// Dotted folder names ("v1.2") fall through to touchesVaultDir in the hook below.
export function affectsVaultScan(filename: string | null): boolean {
  if (!filename) return true;
  const base = path.basename(filename).toLowerCase();
  return base === '.vaultignore' || !base.includes('.') || /\.(md|html?|pdf)$/.test(base);
}

export const vaultWatcher = new FsChangeWatcher(
  'vault:changed',
  (parts) => !parts.some((part) => DEFAULT_EXCLUDES.includes(part)),
  (project) => [project.path, ...parseVaultLinks(project.vault_links).map((link) => link.path)],
  {
    opened: (roots) => roots.forEach((r) => setVaultRootWatched(r, true)),
    closed: (roots) => roots.forEach((r) => setVaultRootWatched(r, false)),
    changed: (root, filename) => {
      if (affectsVaultScan(filename) || touchesVaultDir(root, filename!)) invalidateVaultRoot(root);
    },
  },
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
