// Cross-window message bus for the session-window pop-out feature.
//
// All windows that share an origin (the main app and any popout child
// windows opened via window.open) can use the same BroadcastChannel.
// The channel is GLOBAL (one for the whole app, not per-project): the main
// window only ever mounts one SessionWindowsHost at a time, and a popout's
// group-return must reach whichever project the user is currently viewing —
// that's how a popped-out terminal from project A re-docks into project B's
// workspace (cross-project docking). Hosts filter messages by groupId, so
// traffic for other projects' groups is ignored.
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
// Cross-window drag-dock (popout → popout / popout → main). DOM mouse events
// can't cross OS windows, so once a tab drag leaves the source popout's
// bounds it switches to a bus-mediated protocol driven by SCREEN coordinates
// (mousemove keeps firing on the source window while the button is held,
// even outside its bounds — the same capture behavior main's tear-out
// already relies on):
//   dock-probe        — source → all, cursor screen position while outside
//   dock-probe-result — receiver → source, whether the point hits one of its
//                       stacks, plus its last-focus time (arbitrates when
//                       overlapping windows both report a hit)
//   dock-commit       — source → chosen receiver on mouseup; carries the
//                       session id + color/intent so the receiver can adopt
//   dock-commit-ack   — receiver → source; only on accepted:true does the
//                       source remove the tab from its own tree (the session
//                       can never silently vanish on a dropped message)
//   dock-end          — source → all, gesture over; receivers clear overlays
//
// OpenGroup is intentionally typed as `unknown` here to avoid pulling the
// SessionWindowsHost.tsx import cycle into a low-level utility module.
// Callers cast on receive.

export type BusMessage =
  | { t: 'hello'; from: string; groupId: string }
  | { t: 'group-handoff'; to: string; groupId: string; group: unknown }
  // projectId = the popout's origin project. When the receiving host belongs
  // to a different project it adopts the group into its own workspace and
  // scrubs the origin project's persisted entry (cross-project re-dock).
  | { t: 'group-return'; from: string; groupId: string; group: unknown; projectId?: string }
  | { t: 'group-update'; from: string; groupId: string; patch: unknown }
  | { t: 'group-close'; from: string; groupId: string }
  | { t: 'group-recall'; popoutId: string; groupId: string }
  | { t: 'group-reclaimed'; popoutId: string; groupIds: string[]; reason: 'heartbeat-timeout' | 'late-return' }
  | { t: 'heartbeat'; from: string; ownedGroupIds: string[] }
  | { t: 'bye'; from: string }
  | { t: 'dock-probe'; from: string; x: number; y: number }
  | { t: 'dock-probe-result'; from: string; to: string; hit: boolean; focusAt: number }
  | { t: 'dock-commit'; from: string; to: string; x: number; y: number; sessionId: string; color?: string; intentInfo?: unknown }
  | { t: 'dock-commit-ack'; from: string; to: string; sessionId: string; accepted: boolean }
  | { t: 'dock-end'; from: string };

export interface PopoutBus {
  post: (msg: BusMessage) => void;
  subscribe: (cb: (msg: BusMessage) => void) => () => void;
  close: () => void;
}

const CHANNEL_NAME = 'clitrigger:session-windows:global';

export function openBus(): PopoutBus {
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
  const ch = new BroadcastChannel(CHANNEL_NAME);
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

// ── Cross-window dock geometry ──────────────────────────────────────────────
// Anchor: the most recent mouse event this window saw, both its screen and
// client coords. In Chromium/Electron BOTH screenX/Y and clientX/Y are CSS
// pixels (DIPs), so within one window `screen − client` is an EXACT constant
// offset regardless of display scaling — no dpr factor belongs here. (Dividing
// the delta by dpr makes the result drift with distance from the anchor at
// e.g. 120% → dpr 1.2; that was the docking-coords bug this avoids.) Each
// window (renderer) has its own module instance, so this is per-window.
// Accurate as long as the window hasn't moved since the user last moused over
// it (true mid-drag).
let lastSample: { sx: number; sy: number; cx: number; cy: number } | null = null;

// Install a passive mouse tracker that keeps the anchor fresh. Call once per
// window mount (main host + each popout); returns a cleanup.
export function startViewportTracking(): () => void {
  if (typeof window === 'undefined') return () => { /* SSR/no-DOM */ };
  const onMove = (e: MouseEvent) => {
    lastSample = { sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY };
  };
  window.addEventListener('mousemove', onMove, { passive: true });
  return () => window.removeEventListener('mousemove', onMove);
}

// Convert an OS-screen point to this window's client coordinates.
//   client = sampleClient + (screen − sampleScreen)
// Anchoring on a real event point cancels the unknown viewport origin; screen
// and client are the same unit (CSS px), so the delta needs no scaling. Falls
// back to a chrome estimate only before any mouse event was seen. Mixed-DPI
// multi-monitor can still skew across monitors — the same trade-off the
// tear-out threshold accepts.
export function screenToClient(screenX: number, screenY: number): { x: number; y: number } {
  if (lastSample) {
    return {
      x: lastSample.cx + (screenX - lastSample.sx),
      y: lastSample.cy + (screenY - lastSample.sy),
    };
  }
  const borderX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const chromeTop = Math.max(0, window.outerHeight - window.innerHeight - borderX);
  return { x: screenX - window.screenX - borderX, y: screenY - window.screenY - chromeTop };
}

export function isClientPointInWindow(p: { x: number; y: number }): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= window.innerWidth && p.y <= window.innerHeight;
}

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
