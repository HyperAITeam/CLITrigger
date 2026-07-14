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

// Watches project roots for the docs (Vault) tab so external file changes
// push a `vault:changed` event instead of requiring a manual refresh.
// A project is only watched while at least one client has its docs tab open
// (`vault:watch` / `vault:unwatch` WS messages), so the idle cost is zero.
class VaultWatcher {
  private entries = new Map<string, WatchEntry>();

  /** Start watching a project's root for this client. Silently no-ops when
   *  the project is unknown or fs.watch fails (e.g. inotify limits on large
   *  Linux trees) — the docs tab then degrades to manual refresh. */
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
    // Skip churn in build/VCS directories (npm install, git operations, …).
    // ponytail: coarse segment filter only — .vaultignore'd paths still count
    // as changes because the explorer shows them as hidden entries.
    if (filename) {
      const parts = filename.toString().split(/[\\/]/);
      if (parts.some((part) => DEFAULT_EXCLUDES.includes(part))) return;
    }
    const entry = this.entries.get(projectId);
    if (!entry || entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      broadcaster.broadcast({ type: 'vault:changed', projectId });
    }, BROADCAST_DELAY_MS);
  }
}

export const vaultWatcher = new VaultWatcher();
