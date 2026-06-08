// Cross-window message bus for the session-window pop-out feature.
//
// All windows that share an origin (the main app and any popout child
// windows opened via window.open) can use the same BroadcastChannel.
// The channel is scoped per projectId so two open projects never cross-talk.
//
// Message types:
//   hello           — popout mount → main, requests group payload
//   group-handoff   — main → popout, hands over the OpenGroup blob
//   group-return    — popout → main, returns group ownership
//   group-update    — owner → others, partial OpenGroup patch sync
//   group-close     — either side, group dissolved
//   group-recall    — main → popout, user-initiated "bring back to main".
//                     The popout responds exactly like its own Re-dock button:
//                     posts group-return with its latest payload, then closes.
//   group-reclaimed — main → popout, ownership forcibly reclaimed
//                     (popout missed too many heartbeats); popout must stop
//                     rendering and close to avoid duplicate xterm writes
//                     against the same session binary stream.
//   heartbeat       — owner → others, "still alive"
//   bye             — popout beforeunload, force return
//
// OpenGroup is intentionally typed as `unknown` here to avoid pulling the
// SessionWindowsHost.tsx import cycle into a low-level utility module.
// Callers cast on receive.

export type BusMessage =
  | { t: 'hello'; from: string; groupId: string }
  | { t: 'group-handoff'; to: string; groupId: string; group: unknown }
  | { t: 'group-return'; from: string; groupId: string; group: unknown }
  | { t: 'group-update'; from: string; groupId: string; patch: unknown }
  | { t: 'group-close'; from: string; groupId: string }
  | { t: 'group-recall'; popoutId: string; groupId: string }
  | { t: 'group-reclaimed'; popoutId: string; groupIds: string[]; reason: 'heartbeat-timeout' | 'late-return' }
  | { t: 'heartbeat'; from: string; ownedGroupIds: string[] }
  | { t: 'bye'; from: string };

export interface PopoutBus {
  post: (msg: BusMessage) => void;
  subscribe: (cb: (msg: BusMessage) => void) => () => void;
  close: () => void;
}

const CHANNEL_PREFIX = 'clitrigger:session-windows:';

export function openBus(projectId: string): PopoutBus {
  // BroadcastChannel is supported in all modern browsers and Electron 5+;
  // we fall back to a no-op shim if it's somehow absent so the rest of
  // the app keeps working without popout sync.
  if (typeof BroadcastChannel === 'undefined') {
    return {
      post: () => { /* noop */ },
      subscribe: () => () => { /* noop */ },
      close: () => { /* noop */ },
    };
  }
  const ch = new BroadcastChannel(`${CHANNEL_PREFIX}${projectId}`);
  const listeners = new Set<(msg: BusMessage) => void>();
  ch.onmessage = (ev) => {
    const msg = ev.data as BusMessage;
    for (const cb of listeners) {
      try { cb(msg); } catch { /* one bad listener shouldn't break others */ }
    }
  };
  return {
    post: (msg) => { ch.postMessage(msg); },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    close: () => {
      listeners.clear();
      ch.close();
    },
  };
}

// Constant exported so both main and popout reference the same identifier
// for the "main app window". Popouts use `popout_<uuid>` instead.
export const MAIN_WINDOW_ID = 'main';

export function newPopoutId(): string {
  return `popout_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

// Heartbeat / liveness tuning. Popouts beat every BEAT_MS, main reclaims
// any group whose popout owner hasn't beaten in DEAD_MS.
export const HEARTBEAT_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 15000;

// ── Web Locks liveness ──────────────────────────────────────────────────────
// BroadcastChannel heartbeats are subject to Chromium's intensive timer
// throttling: a popout backgrounded for >5min has its setInterval slowed to
// ~once/min, blowing past HEARTBEAT_TIMEOUT_MS so main wrongly reclaims a
// perfectly-alive window. The Web Locks API is NOT throttled — a popout holds
// an exclusive lock for its whole lifetime and the browser releases it ONLY on
// real close/crash. Main probes navigator.locks.query() before reclaiming a
// timed-out popout: if the lock is still held, the popout is alive (just
// throttled) and we skip the reclaim. Same-origin windows share the lock
// namespace, so main and its popouts see each other's locks.
const LOCK_PREFIX = 'clitrigger:popout-alive:';

export function popoutLockName(popoutId: string): string {
  return `${LOCK_PREFIX}${popoutId}`;
}

export function webLocksAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.locks
    && typeof navigator.locks.query === 'function';
}

// Acquire the popout's liveness lock and hold it until the returned function is
// called (or the window/tab is closed/crashed, which auto-releases it). The
// held promise never resolves on its own; releasing happens via the resolver.
export function holdPopoutLock(popoutId: string): () => void {
  if (!webLocksAvailable()) return () => { /* unsupported → heartbeat-only */ };
  let release = () => { /* set below once the lock is granted */ };
  // request() resolves when the callback's promise settles, so we keep that
  // promise pending and expose its resolver as the release handle.
  navigator.locks.request(popoutLockName(popoutId), () => new Promise<void>((resolve) => {
    release = resolve;
  })).catch(() => { /* lock contention/abort → fall back to heartbeat */ });
  return () => release();
}

// Names of currently-held popout liveness locks, stripped back to popoutIds.
export async function heldPopoutIds(): Promise<Set<string>> {
  if (!webLocksAvailable()) return new Set();
  try {
    const state = await navigator.locks.query();
    const ids = new Set<string>();
    for (const lock of state.held ?? []) {
      if (lock.name?.startsWith(LOCK_PREFIX)) ids.add(lock.name.slice(LOCK_PREFIX.length));
    }
    return ids;
  } catch {
    return new Set();
  }
}
