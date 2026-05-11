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
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import SessionWindow from './SessionWindow';
import { CMD, CMD_FONT } from './terminal-theme';
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
  activeSessionIds,
  simplify,
} from './group/groupTree';
import { assignColor } from './group/colors';
import DockOverlay, { detectDockZone, type DockTargetRect } from './group/DockOverlay';
import * as sessionsApi from '../api/sessions';
import { useI18n } from '../i18n';
import type { Session } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';

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
}

const SessionWindowsContext = createContext<SessionWindowsAPI | null>(null);

export function useSessionWindows(): SessionWindowsAPI {
  const ctx = useContext(SessionWindowsContext);
  if (!ctx) throw new Error('useSessionWindows must be used within SessionWindowsHost');
  return ctx;
}

interface HostProps {
  projectId: string;
  sessions: Session[];
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
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

function lsKey(projectId: string) {
  return `sessionGroups:${projectId}`;
}

interface PersistShape {
  groups: OpenGroup[];
  zCounter: number;
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
  children,
}: HostProps) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<OpenGroup[]>([]);
  const zCounterRef = useRef(0);
  const groupsRef = useRef<OpenGroup[]>([]);
  groupsRef.current = groups;
  const sessionsRef = useRef<Session[]>(sessions);
  sessionsRef.current = sessions;
  const hydratedRef = useRef(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;

  // Hydrate from localStorage once `sessions` has loaded so we can validly
  // prune ids that no longer exist server-side. Skip while sessions is still
  // empty (likely loading) — otherwise we'd discard everything on mount.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (sessions.length === 0) return;
    hydratedRef.current = true;
    const persisted = readPersisted(projectId);
    if (!persisted) return;
    const validIds = new Set(sessions.map(s => s.id));
    const restored: OpenGroup[] = [];
    for (const g of persisted.groups) {
      const pruned = pruneInvalid(g.root, validIds);
      if (!pruned) continue;
      // Keep only colors/intents for ids still present.
      const ids = new Set(allSessionIds(pruned));
      const colors: Record<string, string> = {};
      for (const k of Object.keys(g.colors)) if (ids.has(k)) colors[k] = g.colors[k];
      const intents: Record<string, { intent: WindowIntent; nonce: number }> = {};
      for (const k of Object.keys(g.intents || {})) {
        if (ids.has(k)) intents[k] = { intent: 'open', nonce: 0 }; // restored tabs are replay-only
      }
      // Ensure every id has a color/intent entry.
      for (const id of ids) {
        if (!colors[id]) colors[id] = assignColor(Object.values(colors));
        if (!intents[id]) intents[id] = { intent: 'open', nonce: 0 };
      }
      const safeGeom = sanitizeGeom({ x: g.x, y: g.y, w: g.w, h: g.h });
      restored.push({ ...g, ...safeGeom, root: pruned, colors, intents, minimized: !!g.minimized });
    }
    if (restored.length > 0) {
      zCounterRef.current = persisted.zCounter || restored.length;
      setGroups(restored);
    }
  }, [projectId, sessions]);

  // Persist on every change.
  useEffect(() => {
    writePersisted(projectId, { groups, zCounter: zCounterRef.current });
  }, [projectId, groups]);

  // Auto-prune groups when a session disappears server-side. Skip while
  // sessions is empty (likely a loading blip) so we don't nuke restored state.
  useEffect(() => {
    if (sessions.length === 0) return;
    const validIds = new Set(sessions.map(s => s.id));
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
  }, [sessions]);

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

    const onMove = (ev: MouseEvent) => {
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

  const api = useMemo<SessionWindowsAPI>(() => ({
    openOrFocus, close, focus, minimize, restore, isOpen,
    closeGroup, minimizeGroup, restoreGroup, setGroupGeometry,
    setSplitSizes, setActiveTab, reorderTab,
    beginTabDrag, dockGroup,
  }), [openOrFocus, close, focus, minimize, restore, isOpen,
       closeGroup, minimizeGroup, restoreGroup, setGroupGeometry,
       setSplitSizes, setActiveTab, reorderTab, beginTabDrag, dockGroup]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  const visibleGroups = groups.filter(g => !g.minimized);
  const minimizedGroups = groups.filter(g => g.minimized);

  // ── Dock tray drag-to-reorder ─────────────────────────────────────────
  const dockDragRef = useRef<string | null>(null);
  const dockDragOverRef = useRef<string | null>(null);

  const onDockDragStart = useCallback((groupId: string) => {
    dockDragRef.current = groupId;
  }, []);

  const onDockDragOver = useCallback((e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    dockDragOverRef.current = groupId;
  }, []);

  const onDockDrop = useCallback((e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    const srcId = dockDragRef.current;
    dockDragRef.current = null;
    dockDragOverRef.current = null;
    if (!srcId || srcId === targetGroupId) return;
    setGroups(prev => {
      const next = [...prev];
      const srcIdx = next.findIndex(g => g.id === srcId);
      const dstIdx = next.findIndex(g => g.id === targetGroupId);
      if (srcIdx === -1 || dstIdx === -1) return prev;
      const [moved] = next.splice(srcIdx, 1);
      next.splice(dstIdx, 0, moved);
      return next;
    });
  }, []);

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
            sendMessage={sendMessage}
            subscribeBinary={subscribeBinary}
            onEvent={onEvent}
          />
        );
      })}
      {minimizedGroups.length > 0 && createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: 8, left: 8,
            display: 'flex', gap: 6,
            zIndex: 900,
            maxWidth: 'calc(100vw - 16px)',
            flexWrap: 'wrap',
          }}
        >
          {minimizedGroups.map((g) => {
            const ids = activeSessionIds(g.root);
            const titles = ids.map(id => sessionsById.get(id)?.title || id);
            const label = titles.length === 1 ? titles[0] : `${titles[0]} +${titles.length - 1}`;
            return (
              <div
                key={g.id}
                draggable
                onDragStart={() => onDockDragStart(g.id)}
                onDragOver={(e) => onDockDragOver(e, g.id)}
                onDrop={(e) => onDockDrop(e, g.id)}
                onDragEnd={() => { dockDragRef.current = null; dockDragOverRef.current = null; }}
                onClick={() => restoreGroup(g.id)}
                title={titles.join(' · ')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: CMD.titleBg,
                  border: `1px solid ${CMD.separator}`,
                  borderRadius: 6,
                  padding: '4px 6px 4px 4px',
                  fontFamily: CMD_FONT,
                  fontSize: 12,
                  color: CMD.titleText,
                  cursor: 'grab',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                  maxWidth: 240,
                  userSelect: 'none',
                }}
              >
                {/* color band */}
                <div style={{ display: 'flex', height: 14, width: 14, borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                  {ids.map((id, idx) => (
                    <div key={idx} style={{ flex: 1, background: g.colors[id] || CMD.titleText }} />
                  ))}
                </div>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {label}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); closeGroup(g.id); }}
                  aria-label="close"
                  style={{
                    background: 'transparent', border: 'none', color: CMD.titleText,
                    cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', borderRadius: 3,
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
      {/* Tab drag visual: dock overlay over hovered stack */}
      {dragState && dragState.hoveredRect && (
        <DockOverlay targetRect={dragState.hoveredRect} activeZone={dragState.zone} />
      )}
    </SessionWindowsContext.Provider>
  );
}
