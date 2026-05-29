import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import SessionWindow from './SessionWindow';
import {
  type LayoutNode,
  type Path,
  type DockSide,
  makeStack,
  findStackContaining,
  getNode,
  removeTab,
  insertAtSide,
  insertIntoStack,
  setActiveTab as treeSetActiveTab,
  reorderTab as treeReorderTab,
  setSplitSizes as treeSetSplitSizes,
  pruneInvalid,
  allSessionIds,
  simplify,
} from './group/groupTree';
import { assignColor } from './group/colors';
import DockOverlay, { detectDockZone, type DockTargetRect } from './group/DockOverlay';
import * as sessionsApi from '../api/sessions';
import { useI18n } from '../i18n';
import type { Session } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import {
  openBus,
  MAIN_WINDOW_ID,
  newPopoutId,
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
  type BusMessage,
} from './popout/popoutBus';

interface WindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WindowIntent = 'start' | 'open' | 'resume';

export interface OpenGroup extends WindowGeom {
  id: string;
  z: number;
  minimized: boolean;
  root: LayoutNode;
  colors: Record<string, string>;
  // Per-tab intent so freshly-added tabs auto-start while existing tabs stay
  // in replay-only mode. Bumping the nonce re-triggers a start attempt.
  intents: Record<string, { intent: WindowIntent; nonce: number }>;
  // 'main' = rendered by the primary BrowserRouter window; popout_xxx = owned
  // by a child OS window opened via window.open(). Each window filters the
  // groups array by `ownerWindowId === MY_WINDOW_ID` so the same persisted
  // state can describe both. Optional in the type for backward-compat with
  // pre-popout persisted entries; undefined is treated as 'main'.
  ownerWindowId?: string;
}

interface DragState {
  groupId: string;
  sessionId: string;
  fromPath: Path;
  startX: number;
  startY: number;
  mouseX: number;
  mouseY: number;
  hoveredGroupId: string | null;
  hoveredPath: Path | null;
  hoveredRect: DockTargetRect | null;
  zone: DockSide | null;
}

export interface SessionWindowsAPI {
  // Public, session-id keyed
  openOrFocus: (sessionId: string, intent?: WindowIntent) => void;
  close: (sessionId: string) => void;
  focus: (sessionId: string) => void;
  minimize: (sessionId: string) => void;
  restore: (sessionId: string) => void;
  isOpen: (sessionId: string) => boolean;
  // Group-level (used by SessionWindow internals)
  closeGroup: (groupId: string) => void;
  minimizeGroup: (groupId: string) => void;
  restoreGroup: (groupId: string) => void;
  setGroupGeometry: (groupId: string, geom: WindowGeom) => void;
  setSplitSizes: (groupId: string, path: Path, sizes: number[]) => void;
  setActiveTab: (groupId: string, sessionId: string) => void;
  reorderTab: (groupId: string, sessionId: string, newIndex: number) => void;
  // Tab drag interaction
  beginTabDrag: (groupId: string, sessionId: string, fromPath: Path, e: React.MouseEvent) => void;
  // Dock an entire single-stack group into another group.
  dockGroup: (srcGroupId: string, dstGroupId: string, dstPath: Path, side: DockSide) => void;
  // Pop the group out as a separate OS window (window.open). Main hands the
  // group to a popout via the BroadcastChannel bus and removes it from its
  // own rendered set. No-op for split-root groups in Phase 1.
  //
  // `opts.atScreenX/Y` positions the new OS window at those absolute screen
  // coordinates (chrome-offset applied) — used by drag-out so the popout
  // appears under the user's cursor. Omitted → near the source window.
  popOutGroup: (groupId: string, opts?: { atScreenX?: number; atScreenY?: number }) => void;
  // Spawn a fresh raw-shell session and either add it as a tab to the
  // specified group's stack (when `targetGroupId` resolves to a visible
  // main-owned group) or open it as a new floating window. Used by the "+"
  // button next to tabs and by the Ctrl/Cmd+T global shortcut.
  createRawShellTab: (targetGroupId: string | null, targetPath?: Path) => Promise<void>;
}

const SessionWindowsContext = createContext<SessionWindowsAPI | null>(null);

export function useSessionWindows(): SessionWindowsAPI {
  const ctx = useContext(SessionWindowsContext);
  if (!ctx) throw new Error('useSessionWindows must be used within SessionWindowsHost');
  return ctx;
}

// Variant that returns null when there is no host above (e.g. inside a
// popout OS window, which renders StackView directly without a host).
export function useSessionWindowsOptional(): SessionWindowsAPI | null {
  return useContext(SessionWindowsContext);
}

interface HostProps {
  projectId: string;
  sessions: Session[];
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  // Propagate a freshly created session to ProjectDetail's sessions state
  // (mirrors SessionList's onAddSession). Required for the "+" / Ctrl+T
  // flow — without it, the new sessionId would appear in a tab but the
  // sessions array wouldn't know about it and the pane would render empty.
  onAddSession?: (session: Session) => void;
  children: ReactNode;
}

const DEFAULT_W = 720;
const DEFAULT_H = 460;
const MIN_W = 320;
const MIN_H = 200;
const CASCADE_STEP = 30;
const CASCADE_BASE_X = 80;
const CASCADE_BASE_Y = 80;
const TITLEBAR_VISIBLE = 80;
const CHROME_HEIGHT = 28;

// Repair persisted geometry so a corrupt entry (collapsed to 0×0, far off-
// screen, NaN) can't load as an invisible-but-clickable wrapper that steals
// pointer events from the page underneath. Defensive against schema drift
// and bugs in interrupted drag/resize gestures.
function sanitizeGeom(g: WindowGeom): WindowGeom {
  const vpW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
  let w = Number.isFinite(g.w) && g.w >= MIN_W ? g.w : DEFAULT_W;
  let h = Number.isFinite(g.h) && g.h >= MIN_H ? g.h : DEFAULT_H;
  w = Math.min(w, vpW);
  h = Math.min(h, vpH);
  let x = Number.isFinite(g.x) ? g.x : CASCADE_BASE_X;
  let y = Number.isFinite(g.y) ? g.y : CASCADE_BASE_Y;
  x = Math.max(Math.min(x, vpW - TITLEBAR_VISIBLE), -(w - TITLEBAR_VISIBLE));
  y = Math.max(Math.min(y, vpH - CHROME_HEIGHT), 0);
  return { x, y, w, h };
}
// Pixels of mousemove from drag start that count as "intent to tear" — any
// further and the tab pops out of the docked group as a floating window.
const TAB_DETACH_THRESHOLD = 12;
// Screen-coord distance the cursor must travel outside the main window's
// bounds (after an eager-detach has happened) before the floating group
// is promoted to a separate OS window via popOutGroup.
const TAB_TEAR_OUT_THRESHOLD = 60;

function lsKey(projectId: string) {
  return `sessionGroups:${projectId}`;
}

interface PersistShape {
  groups: OpenGroup[];
  zCounter: number;
  // Snapshot of session.title indexed by session id, captured at the moment
  // we persisted. Needed because the global dock tray reads minimized
  // groups across all projects without loading each project's sessions
  // list, so it has no other way to render real labels.
  titles?: Record<string, string>;
}

function readPersisted(projectId: string): PersistShape | null {
  try {
    const raw = localStorage.getItem(lsKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.groups) && typeof parsed?.zCounter === 'number') {
      return parsed as PersistShape;
    }
  } catch { /* ignore */ }
  return null;
}

function writePersisted(projectId: string, data: PersistShape): void {
  try { localStorage.setItem(lsKey(projectId), JSON.stringify(data)); }
  catch { /* quota etc. */ }
}

function cascadeGeom(existingCount: number): WindowGeom {
  const i = existingCount % 8;
  return {
    x: CASCADE_BASE_X + i * CASCADE_STEP,
    y: CASCADE_BASE_Y + i * CASCADE_STEP,
    w: DEFAULT_W,
    h: DEFAULT_H,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function genId(): string {
  return `g_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function findGroupBySessionId(groups: OpenGroup[], sessionId: string): OpenGroup | null {
  for (const g of groups) {
    if (findStackContaining(g.root, sessionId)) return g;
  }
  return null;
}

export default function SessionWindowsHost({
  projectId,
  sessions,
  sendMessage,
  subscribeBinary,
  onEvent,
  onAddSession,
  children,
}: HostProps) {
  const { t } = useI18n();
  // Read persisted state synchronously on the very first render. Previously
  // we left `groups` empty until a separate hydrate effect could run after
  // `sessions` arrived, but the persist effect (below) fires on the same
  // first commit and wrote the empty `[]` to localStorage before hydrate
  // got a chance — wiping out the very state we were about to restore.
  // The host is keyed by projectId in ProjectDetail so this initializer
  // runs exactly once per project visit (no cross-project state bleed).
  // Restored tabs are demoted to 'open'/nonce 0 (replay-only) so they don't
  // re-spawn a PTY they never owned; invalid session ids stay in the tree
  // briefly and are removed by the prune effect once `sessions` loads —
  // StackView already renders `null` for missing sessions in the interim.
  const [initialState] = useState<{ groups: OpenGroup[]; zCounter: number }>(() => {
    const p = readPersisted(projectId);
    if (!p) return { groups: [], zCounter: 0 };
    const restored: OpenGroup[] = p.groups.map(g => {
      const ids = allSessionIds(g.root);
      const idsSet = new Set(ids);
      const colors: Record<string, string> = {};
      for (const k of Object.keys(g.colors || {})) {
        if (idsSet.has(k)) colors[k] = g.colors[k];
      }
      const intents: Record<string, { intent: WindowIntent; nonce: number }> = {};
      for (const id of ids) {
        intents[id] = { intent: 'open', nonce: 0 };
        if (!colors[id]) colors[id] = assignColor(Object.values(colors));
      }
      // Clamp persisted geometry so an interrupted drag/resize or schema
      // drift can't restore the group off-screen or with NaN dims that
      // render as an invisible click-trap over the page.
      const safeGeom = sanitizeGeom({ x: g.x, y: g.y, w: g.w, h: g.h });
      // Pre-popout entries have no ownerWindowId — coerce to 'main'. Popout-
      // owned entries keep their owner so a refresh of main doesn't snatch
      // back a group that a popout window still holds; the liveness check
      // below reclaims it after HEARTBEAT_TIMEOUT_MS of silence.
      const ownerWindowId = g.ownerWindowId || MAIN_WINDOW_ID;
      return { ...g, ...safeGeom, colors, intents, minimized: !!g.minimized, ownerWindowId };
    });
    // Seed liveness tracker: if a popout was alive at the moment main
    // refreshed (or we navigated to another project and back), we have no
    // entry in alivePopoutsRef yet, so the sweep would never time it out.
    // Seeding with `now` gives each owner a HEARTBEAT_TIMEOUT_MS grace
    // window during which the popout must beat at least once to keep its
    // ownership claim; otherwise we reclaim. Both the orphan-popout-crash
    // and cross-project remount cases are covered by the same seed.
    // (alivePopoutsRef itself is declared below; this initializer can't
    // touch it directly. We push these into a separate one-shot effect.)
    return { groups: restored, zCounter: p.zCounter || restored.length };
  });
  const [groups, setGroups] = useState<OpenGroup[]>(initialState.groups);
  const zCounterRef = useRef<number>(initialState.zCounter);
  const groupsRef = useRef<OpenGroup[]>(groups);
  groupsRef.current = groups;
  const sessionsRef = useRef<Session[]>(sessions);
  sessionsRef.current = sessions;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;

  // Persist on every change. Also snapshot session titles (so the global
  // dock tray can render real labels for chips from other projects without
  // having to load those projects' sessions), then notify the tray to
  // re-read (the `storage` event doesn't fire on same-tab writes).
  useEffect(() => {
    const titles: Record<string, string> = {};
    for (const g of groups) {
      for (const sid of allSessionIds(g.root)) {
        const s = sessions.find(x => x.id === sid);
        if (s?.title) titles[sid] = s.title;
      }
    }
    writePersisted(projectId, { groups, zCounter: zCounterRef.current, titles });
    window.dispatchEvent(new CustomEvent('session-windows:changed'));
  }, [projectId, groups, sessions]);

  // Auto-minimize on host unmount (project navigation / workspace switch).
  // The host is keyed by projectId in ProjectDetail, so leaving the project
  // tears this down. Without this hook, groups that were visible at the
  // moment of navigation persist as `minimized:false` in localStorage —
  // GlobalSessionDockTray only renders chips for `minimized:true`, so the
  // user loses any handle to the session until they navigate back. Flip
  // every main-owned group to minimized in the persisted snapshot before
  // unmount so each becomes a chip in the global tray.
  // Popout-owned groups are left alone: a separate OS window is still
  // rendering them, and writing them as minimized would make the chip
  // compete with that live window.
  useEffect(() => {
    return () => {
      const current = groupsRef.current;
      if (current.length === 0) return;
      let changed = false;
      const next = current.map(g => {
        const owner = g.ownerWindowId || MAIN_WINDOW_ID;
        if (owner !== MAIN_WINDOW_ID || g.minimized) return g;
        changed = true;
        return { ...g, minimized: true };
      });
      if (!changed) return;
      const titles: Record<string, string> = {};
      for (const g of next) {
        for (const sid of allSessionIds(g.root)) {
          const s = sessionsRef.current.find(x => x.id === sid);
          if (s?.title) titles[sid] = s.title;
        }
      }
      writePersisted(projectId, { groups: next, zCounter: zCounterRef.current, titles });
      window.dispatchEvent(new CustomEvent('session-windows:changed'));
    };
  }, [projectId]);

  // Auto-prune groups when a session disappears server-side. Skip while
  // sessions is empty (likely a loading blip) so we don't nuke restored state.
  // Also skip if the sessions belong to another project — during project-to-
  // project navigation ProjectDetail reuses the same instance so `sessions`
  // briefly holds the *previous* project's data until the API fetch completes.
  // Without this guard the stale cross-project IDs would prune every group.
  useEffect(() => {
    if (sessions.length === 0) return;
    const ownSessions = sessions.filter(s => s.project_id === projectId);
    if (ownSessions.length === 0) return;
    const validIds = new Set(ownSessions.map(s => s.id));
    setGroups((prev) => {
      let changed = false;
      const next: OpenGroup[] = [];
      for (const g of prev) {
        const ids = allSessionIds(g.root);
        const hasMissing = ids.some(id => !validIds.has(id));
        if (!hasMissing) { next.push(g); continue; }
        changed = true;
        const pruned = pruneInvalid(g.root, validIds);
        if (!pruned) continue;
        const remaining = new Set(allSessionIds(pruned));
        const colors: Record<string, string> = {};
        for (const k of Object.keys(g.colors)) if (remaining.has(k)) colors[k] = g.colors[k];
        const intents: Record<string, { intent: WindowIntent; nonce: number }> = {};
        for (const k of Object.keys(g.intents)) if (remaining.has(k)) intents[k] = g.intents[k];
        next.push({ ...g, root: pruned, colors, intents });
      }
      return changed ? next : prev;
    });
  }, [sessions, projectId]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const newGroup = useCallback((sessionId: string, intent: WindowIntent): OpenGroup => {
    const existingCount = groupsRef.current.length;
    const geom = cascadeGeom(existingCount);
    zCounterRef.current += 1;
    const z = zCounterRef.current;
    return {
      id: genId(),
      ...geom,
      z,
      minimized: false,
      root: makeStack([sessionId], sessionId),
      colors: { [sessionId]: assignColor([]) },
      intents: { [sessionId]: { intent, nonce: 0 } },
      ownerWindowId: MAIN_WINDOW_ID,
    };
  }, []);

  // ── Public, sessionId-keyed API ───────────────────────────────────────────

  const openOrFocus = useCallback((sessionId: string, intent: WindowIntent = 'open') => {
    setGroups((prev) => {
      const existing = findGroupBySessionId(prev, sessionId);
      zCounterRef.current += 1;
      const z = zCounterRef.current;
      if (existing) {
        return prev.map((g) => {
          if (g.id !== existing.id) return g;
          // Activate tab + bump z + minimize off + intent bump if upgrading
          const prevIntent = g.intents[sessionId]?.intent ?? 'open';
          const isStartIntent = intent === 'start' || intent === 'resume';
          const newIntent: WindowIntent = isStartIntent ? intent : prevIntent;
          const intentChanged = newIntent !== prevIntent || isStartIntent;
          return {
            ...g,
            z,
            minimized: false,
            root: treeSetActiveTab(g.root, sessionId),
            intents: {
              ...g.intents,
              [sessionId]: {
                intent: newIntent,
                nonce: intentChanged ? (g.intents[sessionId]?.nonce ?? 0) + 1 : (g.intents[sessionId]?.nonce ?? 0),
              },
            },
          };
        });
      }
      return [...prev, newGroup(sessionId, intent)];
    });
  }, [newGroup]);

  const focus = useCallback((sessionId: string) => {
    setGroups((prev) => {
      const target = findGroupBySessionId(prev, sessionId);
      if (!target) return prev;
      const max = prev.reduce((m, w) => (w.z > m ? w.z : m), 0);
      if (target.z === max && !target.minimized) return prev;
      zCounterRef.current += 1;
      const z = zCounterRef.current;
      return prev.map((g) => g.id === target.id ? { ...g, z, minimized: false } : g);
    });
  }, []);

  // SessionPane's auto-close only fires when status≠running, so it bypasses this confirm naturally.
  const confirmRunningStop = useCallback((sessionIds: string[]): boolean => {
    const running = sessionIds
      .map(id => sessionsRef.current.find(s => s.id === id))
      .filter((s): s is Session => !!s && s.status === 'running');
    if (running.length === 0) return true;
    if (!window.confirm(t('session.confirmStop'))) return false;
    for (const s of running) {
      sessionsApi.stopSession(s.id).catch(() => { /* swallow — UI tear-down proceeds */ });
    }
    return true;
  }, [t]);

  const close = useCallback((sessionId: string) => {
    if (!confirmRunningStop([sessionId])) return;
    setGroups((prev) => {
      const target = findGroupBySessionId(prev, sessionId);
      if (!target) return prev;
      const newRoot = removeTab(target.root, sessionId);
      if (!newRoot) return prev.filter(g => g.id !== target.id);
      const remaining = new Set(allSessionIds(newRoot));
      const colors = { ...target.colors };
      delete colors[sessionId];
      const intents = { ...target.intents };
      delete intents[sessionId];
      return prev.map(g => g.id === target.id ? { ...g, root: newRoot, colors, intents } : g);
    });
  }, [confirmRunningStop]);

  const minimize = useCallback((sessionId: string) => {
    setGroups((prev) => {
      const target = findGroupBySessionId(prev, sessionId);
      if (!target) return prev;
      return prev.map(g => g.id === target.id ? { ...g, minimized: true } : g);
    });
  }, []);

  const restore = useCallback((sessionId: string) => {
    setGroups((prev) => {
      const target = findGroupBySessionId(prev, sessionId);
      if (!target) return prev;
      zCounterRef.current += 1;
      const z = zCounterRef.current;
      return prev.map(g => g.id === target.id ? { ...g, minimized: false, z } : g);
    });
  }, []);

  const isOpen = useCallback((sessionId: string) => !!findGroupBySessionId(groupsRef.current, sessionId), []);

  // ── Group-level API ──────────────────────────────────────────────────────

  const closeGroup = useCallback((groupId: string) => {
    const group = groupsRef.current.find(g => g.id === groupId);
    if (group && !confirmRunningStop(allSessionIds(group.root))) return;
    setGroups((prev) => prev.filter(g => g.id !== groupId));
  }, [confirmRunningStop]);

  const minimizeGroup = useCallback((groupId: string) => {
    setGroups((prev) => prev.map(g => g.id === groupId ? { ...g, minimized: true } : g));
  }, []);

  // GlobalSessionDockTray dispatches these when a chip is clicked / closed.
  // Same-project chips route through these events so confirmRunningStop /
  // z-ordering go through the canonical paths. Cross-project chips don't
  // reach here — the tray modifies the other project's localStorage directly
  // and the destination host picks up the change on next mount.
  useEffect(() => {
    const onRestoreEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { projectId?: string; groupId?: string } | undefined;
      if (!detail?.projectId || !detail.groupId) return;
      if (detail.projectId !== projectId) return;
      setGroups((prev) => {
        const target = prev.find(g => g.id === detail.groupId);
        if (!target) return prev;
        zCounterRef.current += 1;
        const z = zCounterRef.current;
        return prev.map(g => g.id === detail.groupId ? { ...g, minimized: false, z } : g);
      });
    };
    const onCloseEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { projectId?: string; groupId?: string } | undefined;
      if (!detail?.projectId || !detail.groupId) return;
      if (detail.projectId !== projectId) return;
      const group = groupsRef.current.find(g => g.id === detail.groupId);
      if (group && !confirmRunningStop(allSessionIds(group.root))) return;
      setGroups((prev) => prev.filter(g => g.id !== detail.groupId));
    };
    window.addEventListener('session-windows:restore', onRestoreEvent);
    window.addEventListener('session-windows:close', onCloseEvent);
    return () => {
      window.removeEventListener('session-windows:restore', onRestoreEvent);
      window.removeEventListener('session-windows:close', onCloseEvent);
    };
  }, [projectId, confirmRunningStop]);

  // Cross-project restore handoff: tray writes `pendingSessionRestore` to
  // sessionStorage then navigates; the destination host (this one, after
  // remount via key={projectId}) picks it up here on mount and un-minimizes
  // the requested group. Mismatched projectIds are ignored so the intent
  // survives an accidental wrong-project mount.
  useEffect(() => {
    const raw = sessionStorage.getItem('pendingSessionRestore');
    if (!raw) return;
    try {
      const intent = JSON.parse(raw) as { projectId?: string; groupId?: string };
      if (intent.projectId !== projectId || !intent.groupId) return;
      sessionStorage.removeItem('pendingSessionRestore');
      setGroups((prev) => {
        const target = prev.find(g => g.id === intent.groupId);
        if (!target) return prev;
        zCounterRef.current += 1;
        const z = zCounterRef.current;
        return prev.map(g => g.id === intent.groupId ? { ...g, minimized: false, z } : g);
      });
    } catch { /* ignore malformed intent */ }
  }, [projectId]);

  const restoreGroup = useCallback((groupId: string) => {
    setGroups((prev) => {
      const target = prev.find(g => g.id === groupId);
      if (!target) return prev;
      zCounterRef.current += 1;
      const z = zCounterRef.current;
      return prev.map(g => g.id === groupId ? { ...g, minimized: false, z } : g);
    });
  }, []);

  const setGroupGeometry = useCallback((groupId: string, geom: WindowGeom) => {
    setGroups((prev) => prev.map(g => g.id === groupId ? { ...g, ...geom } : g));
  }, []);

  const setSplitSizes = useCallback((groupId: string, path: Path, sizes: number[]) => {
    setGroups((prev) => prev.map(g => g.id === groupId ? { ...g, root: treeSetSplitSizes(g.root, path, sizes) } : g));
  }, []);

  const setActiveTab = useCallback((groupId: string, sessionId: string) => {
    setGroups((prev) => prev.map(g => g.id === groupId ? { ...g, root: treeSetActiveTab(g.root, sessionId) } : g));
  }, []);

  const reorderTab = useCallback((groupId: string, sessionId: string, newIndex: number) => {
    setGroups((prev) => prev.map(g => g.id === groupId ? { ...g, root: treeReorderTab(g.root, sessionId, newIndex) } : g));
  }, []);

  // ── Tab drag (dock / detach) ─────────────────────────────────────────────
  //
  // Chrome-tab-tearing model: while the cursor stays inside the source group's
  // rect the tab sits in place and we render dock previews over sibling stacks.
  // The instant the cursor leaves the source rect we eagerly tear the tab
  // into a new floating group at the cursor; subsequent mousemoves drag that
  // window. On release, if a dock zone is hovered we re-dock; otherwise the
  // floating window stays where the cursor ended.
  const beginTabDrag = useCallback((groupId: string, sessionId: string, fromPath: Path, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const startGroup = groupsRef.current.find(g => g.id === groupId);
    if (!startGroup) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    // Closure flag: id of the floating group once we've torn the tab off,
    // null while still attached to the source. Captured by onMove/onUp.
    let detachedId: string | null = null;

    setDragState({
      groupId, sessionId, fromPath,
      startX, startY,
      mouseX: startX, mouseY: startY,
      hoveredGroupId: null, hoveredPath: null, hoveredRect: null, zone: null,
    });

    const performEagerDetach = (mouseX: number, mouseY: number) => {
      const newId = genId();
      detachedId = newId;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const newGeom: WindowGeom = {
        x: clamp(mouseX - 60, -DEFAULT_W + TITLEBAR_VISIBLE, vpW - TITLEBAR_VISIBLE),
        y: clamp(mouseY - 12, 0, vpH - CHROME_HEIGHT),
        w: DEFAULT_W,
        h: DEFAULT_H,
      };
      setGroups((prev) => {
        const src = prev.find(g => g.id === groupId);
        if (!src) return prev;
        const srcRoot = removeTab(src.root, sessionId);
        const srcColor = src.colors[sessionId] || assignColor([]);
        const srcIntent = src.intents[sessionId] ?? { intent: 'open' as WindowIntent, nonce: 0 };
        zCounterRef.current += 1;
        const z = zCounterRef.current;
        const detached: OpenGroup = {
          id: newId,
          ...newGeom,
          z,
          minimized: false,
          root: makeStack([sessionId], sessionId),
          colors: { [sessionId]: srcColor },
          intents: { [sessionId]: srcIntent },
          ownerWindowId: MAIN_WINDOW_ID,
        };
        const next: OpenGroup[] = [];
        for (const g of prev) {
          if (g.id === groupId) {
            if (srcRoot) {
              const remaining = new Set(allSessionIds(srcRoot));
              const colors: Record<string, string> = {};
              for (const k of Object.keys(g.colors)) if (remaining.has(k)) colors[k] = g.colors[k];
              const intents: Record<string, { intent: WindowIntent; nonce: number }> = {};
              for (const k of Object.keys(g.intents)) if (remaining.has(k)) intents[k] = g.intents[k];
              next.push({ ...g, root: simplify(srcRoot), colors, intents });
            }
            // else drop the empty origin group
          } else {
            next.push(g);
          }
        }
        next.push(detached);
        return next;
      });
    };

    // Once the floating group has been promoted to an OS window we stop
    // sliding it and detach the gesture — the OS owns the window now.
    let tornOut = false;

    const isCursorOutsideMainWindow = (ev: MouseEvent): boolean => {
      const winL = window.screenX;
      const winT = window.screenY;
      const winR = winL + window.outerWidth;
      const winB = winT + window.outerHeight;
      return (
        ev.screenX < winL - TAB_TEAR_OUT_THRESHOLD ||
        ev.screenX > winR + TAB_TEAR_OUT_THRESHOLD ||
        ev.screenY < winT - TAB_TEAR_OUT_THRESHOLD ||
        ev.screenY > winB + TAB_TEAR_OUT_THRESHOLD
      );
    };

    const onMove = (ev: MouseEvent) => {
      if (tornOut) return;
      const cur = dragStateRef.current;
      if (!cur) return;

      if (!detachedId) {
        const movedDist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (movedDist >= TAB_DETACH_THRESHOLD) performEagerDetach(ev.clientX, ev.clientY);
      } else {
        // Slide the floating window with the cursor.
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        const newX = clamp(ev.clientX - 60, -(DEFAULT_W - TITLEBAR_VISIBLE), vpW - TITLEBAR_VISIBLE);
        const newY = clamp(ev.clientY - 12, 0, vpH - CHROME_HEIGHT);
        setGroups((prev) => prev.map(g => g.id === detachedId ? { ...g, x: newX, y: newY } : g));
      }

      // Tear-out → OS window: only meaningful once detached (we need an id
      // to hand off). The check is screen-coord-based and multi-monitor
      // tolerant (negative values intentionally not clamped). Bail out of
      // the gesture cleanly: detach listeners, clear hover state, and call
      // popOutGroup which performs the handoff + window.open.
      //
      // Race guard: performEagerDetach above schedules a React state update
      // that may not have flushed yet on the next mousemove tick, so
      // groupsRef wouldn't see the detached group and popOutGroup would
      // no-op. Skip this iteration in that case — the next move will retry
      // (a few ms later) once React has committed.
      if (
        detachedId &&
        isCursorOutsideMainWindow(ev) &&
        groupsRef.current.some(g => g.id === detachedId)
      ) {
        const popFn = popOutGroupRef.current;
        if (popFn) {
          tornOut = true;
          const idToPop = detachedId;
          detachListeners();
          setDragState(null);
          popFn(idToPop, { atScreenX: ev.screenX, atScreenY: ev.screenY });
          return;
        }
      }

      // Hit-test for a dock target. `elementsFromPoint` (plural) walks the
      // z-stack so we can skip our own floating window and still see groups
      // beneath it. Skip same-stack pre-detach and self-group post-detach.
      let hoveredGroupId: string | null = null;
      let hoveredPath: Path | null = null;
      let hoveredRect: DockTargetRect | null = null;
      let zone: DockSide | null = null;
      const els = document.elementsFromPoint(ev.clientX, ev.clientY) as HTMLElement[];
      for (const node of els) {
        const cand = node.closest('[data-group-id][data-stack-path]') as HTMLElement | null;
        if (!cand) continue;
        const gid = cand.dataset.groupId || '';
        const pathStr = cand.dataset.stackPath || '';
        const isSelf = detachedId
          ? gid === detachedId
          : gid === cur.groupId && pathStr === cur.fromPath.join('.');
        if (isSelf) continue;
        const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
        const r = cand.getBoundingClientRect();
        hoveredGroupId = gid;
        hoveredPath = path;
        hoveredRect = { x: r.left, y: r.top, w: r.width, h: r.height };
        zone = detectDockZone(ev.clientX, ev.clientY, hoveredRect);
        break;
      }
      setDragState({
        ...cur,
        mouseX: ev.clientX, mouseY: ev.clientY,
        hoveredGroupId, hoveredPath, hoveredRect, zone,
      });
    };

    let cleaned = false;
    const detachListeners = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onAbort);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
    };
    // Abort: cancel the gesture cleanly when interrupted (alt-tab, tab
    // hide, Escape) before mouseup reaches us. If the tab has already
    // been torn into a floating group, leave it where it is; if not yet
    // detached, the tab simply stays in its original stack.
    const onAbort = () => {
      detachListeners();
      setDragState(null);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onAbort(); };
    const onVis = () => { if (document.hidden) onAbort(); };

    const onUp = () => {
      detachListeners();
      const cur = dragStateRef.current;
      setDragState(null);
      if (!cur) return;

      if (cur.hoveredGroupId && cur.hoveredPath && cur.zone) {
        // Dock into another stack. After eager detach the source is the
        // floating group; pre-detach (cursor never left the source rect) it
        // is still the origin group.
        const srcId = detachedId || cur.groupId;
        applyDock(srcId, cur.sessionId, cur.hoveredGroupId, cur.hoveredPath, cur.zone);
        return;
      }
      // No dock target. If detached, the floating group is already at the
      // cursor (geometry committed during drag). If not detached, the user
      // never left the source rect — treat as a click and do nothing
      // (active-tab swap already happened on mousedown).
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onAbort);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
  }, []);

  const applyDock = useCallback((srcGroupId: string, srcSessionId: string, dstGroupId: string, dstPath: Path, side: DockSide) => {
    setGroups((prev) => {
      const src = prev.find(g => g.id === srcGroupId);
      const dst = prev.find(g => g.id === dstGroupId);
      if (!src || !dst) return prev;

      // Same-group dock: src and dst share one tree. Removing the tab can
      // collapse a sibling split, which would invalidate dstPath — so anchor
      // on a sibling tab in the destination stack and recompute the path
      // after removal.
      if (srcGroupId === dstGroupId) {
        const dstNode = getNode(src.root, dstPath);
        if (!dstNode || dstNode.kind !== 'stack') return prev;
        const anchor = dstNode.tabs.find(t => t !== srcSessionId);
        if (!anchor) return prev;
        const afterRemove = removeTab(src.root, srcSessionId);
        if (!afterRemove) return prev;
        const newDstPath = findStackContaining(afterRemove, anchor);
        if (!newDstPath) return prev;
        let newRoot: LayoutNode;
        if (side === 'center') {
          newRoot = insertIntoStack(afterRemove, newDstPath, srcSessionId);
        } else {
          newRoot = insertAtSide(afterRemove, newDstPath, side, makeStack([srcSessionId]));
        }
        newRoot = treeSetActiveTab(newRoot, srcSessionId);
        return prev.map(g => {
          if (g.id !== srcGroupId) return g;
          zCounterRef.current += 1;
          return { ...g, root: newRoot, z: zCounterRef.current, minimized: false };
        });
      }

      // Cross-group dock: remove from src tree, insert into dst tree.
      const srcRoot = removeTab(src.root, srcSessionId);
      const srcColor = src.colors[srcSessionId];
      const srcIntent = src.intents[srcSessionId] ?? { intent: 'open' as WindowIntent, nonce: 0 };
      let dstRoot: LayoutNode;
      if (side === 'center') {
        dstRoot = insertIntoStack(dst.root, dstPath, srcSessionId);
      } else {
        const newStack = makeStack([srcSessionId]);
        dstRoot = insertAtSide(dst.root, dstPath, side, newStack);
      }
      dstRoot = treeSetActiveTab(dstRoot, srcSessionId);
      const dstColors = { ...dst.colors };
      if (!dstColors[srcSessionId]) dstColors[srcSessionId] = srcColor || assignColor(Object.values(dstColors));
      const dstIntents = { ...dst.intents, [srcSessionId]: srcIntent };
      const next: OpenGroup[] = [];
      for (const g of prev) {
        if (g.id === srcGroupId) {
          if (srcRoot) {
            const remaining = new Set(allSessionIds(srcRoot));
            const colors: Record<string, string> = {};
            for (const k of Object.keys(g.colors)) if (remaining.has(k)) colors[k] = g.colors[k];
            const intents: Record<string, { intent: WindowIntent; nonce: number }> = {};
            for (const k of Object.keys(g.intents)) if (remaining.has(k)) intents[k] = g.intents[k];
            next.push({ ...g, root: srcRoot, colors, intents });
          }
          // else drop the empty group
        } else if (g.id === dstGroupId) {
          zCounterRef.current += 1;
          next.push({ ...g, root: dstRoot, colors: dstColors, intents: dstIntents, z: zCounterRef.current, minimized: false });
        } else {
          next.push(g);
        }
      }
      return next;
    });
  }, []);

// Move an entire single-stack group into another group at the given side.
  // For `center` the source's tabs are appended to the destination stack;
  // for `left|right|top|bottom` the source's stack is wrapped alongside the
  // destination's path in a new split. The source group is dropped after.
  // Source groups whose root is itself a split are not supported by this
  // path (chrome-drag dock is exposed only on single-stack groups).
  const dockGroup = useCallback((srcGroupId: string, dstGroupId: string, dstPath: Path, side: DockSide) => {
    setGroups((prev) => {
      if (srcGroupId === dstGroupId) return prev;
      const src = prev.find(g => g.id === srcGroupId);
      const dst = prev.find(g => g.id === dstGroupId);
      if (!src || !dst) return prev;
      if (src.root.kind !== 'stack') return prev;
      const srcStack = src.root;
      let newDstRoot: LayoutNode;
      if (side === 'center') {
        newDstRoot = srcStack.tabs.reduce<LayoutNode>(
          (root, sid) => insertIntoStack(root, dstPath, sid),
          dst.root,
        );
      } else {
        newDstRoot = insertAtSide(dst.root, dstPath, side, srcStack);
      }
      newDstRoot = treeSetActiveTab(newDstRoot, srcStack.activeTab);
      const dstColors = { ...dst.colors, ...src.colors };
      const dstIntents = { ...dst.intents, ...src.intents };
      const next: OpenGroup[] = [];
      for (const g of prev) {
        if (g.id === srcGroupId) continue;
        if (g.id === dstGroupId) {
          zCounterRef.current += 1;
          next.push({ ...g, root: newDstRoot, colors: dstColors, intents: dstIntents, z: zCounterRef.current, minimized: false });
        } else {
          next.push(g);
        }
      }
      return next;
    });
  }, []);

  // ── Popout (OS-window) integration ───────────────────────────────────────
  //
  // Main holds a project-scoped BroadcastChannel. When the user clicks
  // "Pop out" on a single-stack group, main:
  //   1. assigns a fresh popoutId and writes it to the group's ownerWindowId
  //      (filter side-effect: main no longer renders the group)
  //   2. broadcasts a `group-handoff` with the full OpenGroup payload
  //   3. window.open(/popout/...) — the new BrowserWindow / browser tab
  //      mounts PopoutPage which posts `hello` on mount; if the handoff
  //      already arrived first, fine; if not, our hello handler re-emits.
  //
  // Heartbeat: popouts beat every HEARTBEAT_MS. Main tracks last-seen and
  // reclaims (resets ownerWindowId to 'main') after HEARTBEAT_TIMEOUT_MS.
  // This handles popout crash, user closing without clicking Re-dock, and
  // the case where main refreshes (rehydrates ownership=popout_x) while
  // the popout is gone.
  const busRef = useRef<ReturnType<typeof openBus> | null>(null);
  const alivePopoutsRef = useRef<Map<string, number>>(new Map());
  // Cache of full OpenGroup payloads keyed by groupId, so we can answer a
  // popout's `hello` after we've already removed the group from React state.
  const handoffCacheRef = useRef<Map<string, OpenGroup>>(new Map());
  // Forward reference to popOutGroup so beginTabDrag (defined earlier) can
  // invoke it for tab-tear-out → OS-window without restructuring the file.
  // Assigned below right after popOutGroup is defined.
  const popOutGroupRef = useRef<((groupId: string, opts?: { atScreenX?: number; atScreenY?: number }) => void) | null>(null);

  const popOutGroup = useCallback((groupId: string, opts?: { atScreenX?: number; atScreenY?: number }) => {
    const group = groupsRef.current.find(g => g.id === groupId);
    if (!group) return;
    // Phase 1 limitation: only single-stack groups can pop out. Split-root
    // groups would need PopoutPage to render the full layout tree which is
    // deferred. Surface a notice and bail rather than silently doing nothing.
    if (group.root.kind !== 'stack') {
      window.alert(t('session.popout.splitNotSupported') || 'Only single-stack groups can pop out in this version.');
      return;
    }
    const popoutId = newPopoutId();
    const handoffPayload: OpenGroup = { ...group, ownerWindowId: popoutId };
    handoffCacheRef.current.set(groupId, handoffPayload);
    alivePopoutsRef.current.set(popoutId, Date.now());
    setGroups((prev) => prev.map(g => g.id === groupId ? { ...g, ownerWindowId: popoutId } : g));
    busRef.current?.post({ t: 'group-handoff', to: popoutId, groupId, group: handoffPayload });
    // Position the new OS window. Drag-out path supplies cursor screen
    // coords so the popout opens under the user's pointer with a small
    // chrome offset. Button-click path falls back to the source window's
    // position in screen space. Negative values are clamped to 0 because
    // window.open rejects negative left/top on most platforms.
    const cursorMode = opts && (typeof opts.atScreenX === 'number' || typeof opts.atScreenY === 'number');
    const left = cursorMode
      ? Math.max(0, (opts?.atScreenX ?? window.screenX + group.x) - 40)
      : Math.max(0, window.screenX + group.x);
    const top = cursorMode
      ? Math.max(0, (opts?.atScreenY ?? window.screenY + group.y) - 12)
      : Math.max(0, window.screenY + group.y);
    const feat = [
      'popup',
      `width=${Math.max(400, group.w)}`,
      `height=${Math.max(300, group.h + 40)}`,
      `left=${left}`,
      `top=${top}`,
    ].join(',');
    const url = `/popout/${encodeURIComponent(projectId)}/${encodeURIComponent(groupId)}?wid=${encodeURIComponent(popoutId)}`;
    const w = window.open(url, '_blank', feat);
    if (!w) {
      // Popup blocked. Roll back ownership so the group reappears in main.
      handoffCacheRef.current.delete(groupId);
      alivePopoutsRef.current.delete(popoutId);
      setGroups((prev) => prev.map(g => g.id === groupId ? { ...g, ownerWindowId: MAIN_WINDOW_ID } : g));
      window.alert(t('session.popout.blocked') || 'Popup blocked. Allow popups for this site to use Pop Out.');
    }
  }, [projectId, t]);
  // Keep the forward ref pointed at the latest popOutGroup callback so
  // beginTabDrag (defined earlier) can invoke it for tear-out → OS window.
  popOutGroupRef.current = popOutGroup;

  // Resolve the path of the first stack in DFS order. Used by Ctrl/Cmd+T
  // when adding a raw-shell tab to a group whose root may be a split — we
  // pick the leftmost/topmost stack as a sensible default target.
  const firstStackPath = useCallback((node: LayoutNode): Path => {
    if (node.kind === 'stack') return [];
    return [0, ...firstStackPath(node.children[0])];
  }, []);

  const createRawShellTab = useCallback(async (targetGroupId: string | null, targetPath?: Path) => {
    // Title needs to be unique-ish so the sidebar / session list doesn't
    // show a wall of identical "Shell" rows. Time-of-day is enough.
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const session = await sessionsApi.createSession(projectId, {
      title: `Shell ${hh}:${mm}:${ss}`,
      cli_tool: 'raw-shell',
      use_worktree: false,
      memory_inject_mode: 'none',
    });
    onAddSession?.(session);

    const target = targetGroupId
      ? groupsRef.current.find(g => g.id === targetGroupId)
      : null;
    const targetIsMainOwned = target && (target.ownerWindowId || MAIN_WINDOW_ID) === MAIN_WINDOW_ID;

    if (!target || !targetIsMainOwned) {
      // No host group to attach to (or popout owns it) — spawn a new
      // floating window. Intent 'start' triggers auto-start in SessionPane.
      openOrFocus(session.id, 'start');
      return;
    }

    // Insert into the target stack. Falls back to the first stack in DFS
    // order when no path is supplied (Ctrl/Cmd+T path) or the supplied
    // path doesn't resolve to a stack (defensive).
    const resolvedPath = (() => {
      if (targetPath) {
        const node = getNode(target.root, targetPath);
        if (node && node.kind === 'stack') return targetPath;
      }
      return firstStackPath(target.root);
    })();

    zCounterRef.current += 1;
    const z = zCounterRef.current;
    setGroups((prev) => prev.map(g => {
      if (g.id !== target.id) return g;
      const newRoot = treeSetActiveTab(insertIntoStack(g.root, resolvedPath, session.id), session.id);
      return {
        ...g,
        root: newRoot,
        z,
        minimized: false,
        colors: { ...g.colors, [session.id]: assignColor(Object.values(g.colors)) },
        intents: { ...g.intents, [session.id]: { intent: 'start' as WindowIntent, nonce: 0 } },
      };
    }));
  }, [projectId, onAddSession, openOrFocus, firstStackPath]);

  // Bus subscription: handle messages from popout children. Lives in the
  // host so we can mutate the React `groups` state directly. Survives the
  // host's lifetime and is torn down on unmount.
  useEffect(() => {
    const bus = openBus(projectId);
    busRef.current = bus;
    const onMsg = (msg: BusMessage) => {
      if (msg.t === 'hello') {
        // A popout has mounted and is asking for its group. Look up in cache
        // (we keep the payload after handoff for exactly this re-ask).
        const cached = handoffCacheRef.current.get(msg.groupId);
        if (cached && cached.ownerWindowId === msg.from) {
          bus.post({ t: 'group-handoff', to: msg.from, groupId: msg.groupId, group: cached });
        } else {
          // Maybe the popout just relaunched after main refreshed — find the
          // current group in React state by id and resend.
          const live = groupsRef.current.find(g => g.id === msg.groupId);
          if (live && live.ownerWindowId === msg.from) {
            bus.post({ t: 'group-handoff', to: msg.from, groupId: msg.groupId, group: live });
          }
        }
      } else if (msg.t === 'group-return' || msg.t === 'bye') {
        // Popout returned ownership. Re-render in main. For group-return we
        // accept the popout's latest payload (active tab, geometry changes
        // they may have made). For `bye` without a payload we keep whatever
        // we have but flip the owner back to main.
        if (msg.t === 'group-return') {
          const payload = msg.group as OpenGroup | undefined;
          if (payload && payload.id === msg.groupId) {
            handoffCacheRef.current.delete(msg.groupId);
            alivePopoutsRef.current.delete(msg.from);
            setGroups((prev) => {
              // If main no longer has this group in its array, restore it.
              const exists = prev.find(g => g.id === msg.groupId);
              const restored: OpenGroup = { ...payload, ownerWindowId: MAIN_WINDOW_ID };
              return exists
                ? prev.map(g => g.id === msg.groupId ? restored : g)
                : [...prev, restored];
            });
          }
        } else {
          alivePopoutsRef.current.delete(msg.from);
          setGroups((prev) => prev.map(g =>
            g.ownerWindowId === msg.from ? { ...g, ownerWindowId: MAIN_WINDOW_ID } : g,
          ));
        }
      } else if (msg.t === 'group-close') {
        // Popout closed the group entirely (e.g. user closed the tab inside
        // the popout). Drop it from main as well.
        handoffCacheRef.current.delete(msg.groupId);
        setGroups((prev) => prev.filter(g => g.id !== msg.groupId));
      } else if (msg.t === 'heartbeat') {
        // Mark popout alive. ownedGroupIds is informational; the popoutId is
        // the key for liveness.
        alivePopoutsRef.current.set(msg.from, Date.now());
      } else if (msg.t === 'group-update') {
        // Popout edited the group locally (active tab, geometry). Mirror the
        // patch into main's persisted state so a cold reload preserves it.
        const patch = msg.patch as Partial<OpenGroup>;
        setGroups((prev) => prev.map(g => g.id === msg.groupId ? { ...g, ...patch } : g));
      }
    };
    const unsub = bus.subscribe(onMsg);
    return () => {
      unsub();
      bus.close();
      busRef.current = null;
    };
  }, [projectId]);

  // One-shot seed for liveness tracking on mount. Covers two cases:
  // (1) main refreshed while a popout was alive — persisted state still
  //     names the popoutId as owner but alivePopoutsRef is empty.
  // (2) cross-project navigation: this host unmounts/remounts with a new
  //     projectId, same persisted shape.
  // Without seeding, the sweep would never time these out and orphaned
  // groups would be invisible forever in main. Seeding with `now` starts
  // the HEARTBEAT_TIMEOUT_MS grace clock — popouts that are actually alive
  // will beat at least once before the deadline.
  useEffect(() => {
    const now = Date.now();
    for (const g of initialState.groups) {
      if (g.ownerWindowId && g.ownerWindowId !== MAIN_WINDOW_ID) {
        alivePopoutsRef.current.set(g.ownerWindowId, now);
      }
    }
    // Intentionally one-shot: subsequent renders' groups updates come from
    // popOutGroup / bus messages which manage alivePopoutsRef themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Liveness sweep: reclaim popouts that haven't beaten in HEARTBEAT_TIMEOUT_MS.
  // Runs every HEARTBEAT_MS. Also a grace period for the very-first popout
  // mount: we seed last-seen=now in popOutGroup before opening the window.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      const dead: string[] = [];
      for (const [pid, last] of alivePopoutsRef.current.entries()) {
        if (now - last > HEARTBEAT_TIMEOUT_MS) dead.push(pid);
      }
      if (dead.length === 0) return;
      for (const pid of dead) alivePopoutsRef.current.delete(pid);
      // Clear cached handoff payloads for groups whose owner just died.
      // The cache is keyed by groupId, so we have to scan; small N (≤ open
      // popouts in this project), runs at most every HEARTBEAT_MS.
      const deadSet = new Set(dead);
      for (const g of groupsRef.current) {
        if (g.ownerWindowId && deadSet.has(g.ownerWindowId)) {
          handoffCacheRef.current.delete(g.id);
        }
      }
      // Notify each (potentially) still-running popout that we've reclaimed
      // its groups so it tears down its xterm subscription and closes
      // before the reclaim makes those groups visible in main again. Without
      // this the popout keeps rendering its cached group state and both
      // windows subscribe to the same session binary stream, which makes
      // term.write() fire twice per frame and corrupts the cursor.
      // Heartbeat timeout doesn't mean the popout is necessarily dead — it
      // may just be background-throttled or briefly unresponsive.
      for (const pid of dead) {
        const reclaimedGroupIds = groupsRef.current
          .filter(g => g.ownerWindowId === pid)
          .map(g => g.id);
        if (reclaimedGroupIds.length > 0) {
          busRef.current?.post({
            t: 'group-reclaimed',
            popoutId: pid,
            groupIds: reclaimedGroupIds,
            reason: 'heartbeat-timeout',
          });
        }
      }
      setGroups((prev) => prev.map(g =>
        g.ownerWindowId && dead.includes(g.ownerWindowId)
          ? { ...g, ownerWindowId: MAIN_WINDOW_ID }
          : g,
      ));
    }, HEARTBEAT_MS);
    return () => clearInterval(tick);
  }, []);

  const api = useMemo<SessionWindowsAPI>(() => ({
    openOrFocus, close, focus, minimize, restore, isOpen,
    closeGroup, minimizeGroup, restoreGroup, setGroupGeometry,
    setSplitSizes, setActiveTab, reorderTab,
    beginTabDrag, dockGroup, popOutGroup, createRawShellTab,
  }), [openOrFocus, close, focus, minimize, restore, isOpen,
       closeGroup, minimizeGroup, restoreGroup, setGroupGeometry,
       setSplitSizes, setActiveTab, reorderTab, beginTabDrag, dockGroup, popOutGroup, createRawShellTab]);

  // Global Ctrl+T / Cmd+T → new raw-shell tab in the topmost main-owned
  // visible group, or a new floating window when none exists. preventDefault
  // so the browser / Electron doesn't open a real new tab. Single-key combo
  // (no shift / alt / opposite mod) to avoid stomping on other shortcuts.
  // The matching xterm customKeyEventHandler swallows the same combo so the
  // PTY doesn't also receive ^T while the terminal has focus.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const mod = isMac ? ev.metaKey : ev.ctrlKey;
      const otherMod = isMac ? ev.ctrlKey : ev.metaKey;
      if (!mod || otherMod || ev.altKey || ev.shiftKey) return;
      if (ev.key.toLowerCase() !== 't') return;
      ev.preventDefault();
      const visible = groupsRef.current.filter(g =>
        !g.minimized && (g.ownerWindowId || MAIN_WINDOW_ID) === MAIN_WINDOW_ID,
      );
      const topmost = visible.reduce<OpenGroup | null>(
        (acc, g) => (acc && acc.z >= g.z ? acc : g),
        null,
      );
      createRawShellTab(topmost?.id ?? null).catch(() => { /* swallow — user-visible error surfaced via toast layer if any */ });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createRawShellTab]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  // Minimized chips are now rendered by GlobalSessionDockTray at the App
  // level so they stay visible across workspace switches. This host only
  // renders the visible (non-minimized) floating windows for its project,
  // and only those it owns — popout-owned groups are rendered by their
  // respective OS child window via PopoutPage.
  const visibleGroups = groups.filter(g =>
    !g.minimized && (g.ownerWindowId || MAIN_WINDOW_ID) === MAIN_WINDOW_ID,
  );
  // The topmost (= highest z) visible group is treated as the "active" window.
  // Used purely as a visual hint so the user can tell which floating terminal
  // their next keystroke will land in.
  const topmostGroupId = visibleGroups.reduce<{ id: string | null; z: number }>(
    (acc, g) => (g.z > acc.z ? { id: g.id, z: g.z } : acc),
    { id: null, z: -Infinity },
  ).id;

  return (
    <SessionWindowsContext.Provider value={api}>
      {children}
      {visibleGroups.map((g) => {
        const neighborGeoms = visibleGroups
          .filter(v => v.id !== g.id)
          .map(({ x, y, w, h }) => ({ x, y, w, h }));
        return (
          <SessionWindow
            key={g.id}
            group={g}
            sessionsById={sessionsById}
            neighbors={neighborGeoms}
            isTopmost={g.id === topmostGroupId}
            sendMessage={sendMessage}
            subscribeBinary={subscribeBinary}
            onEvent={onEvent}
          />
        );
      })}
      {/* Tab drag visual: dock overlay over hovered stack */}
      {dragState && dragState.hoveredRect && (
        <DockOverlay targetRect={dragState.hoveredRect} activeZone={dragState.zone} />
      )}
    </SessionWindowsContext.Provider>
  );
}
