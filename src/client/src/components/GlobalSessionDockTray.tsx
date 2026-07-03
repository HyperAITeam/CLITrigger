// App-level dock tray for minimized session windows. Lives above ProjectDetail
// so it stays mounted across workspace switches — minimized sessions from any
// project remain visible until the user explicitly closes them.
//
// State source: each project's host writes its groups to
// `localStorage["sessionGroups:<projectId>"]`. We aggregate by walking every
// key with that prefix and pulling out groups where `minimized === true`.
// Updates come from two channels:
//   - the `storage` event (fires in OTHER tabs when a project's host writes)
//   - the custom `session-windows:changed` event (the host dispatches this on
//     every persist so the tray re-reads in the SAME tab too — `storage` is
//     not delivered to the originating tab)
//
// Click semantics:
//   - same-project chip: dispatch `session-windows:restore` for the host to
//     route through its canonical restore logic (z-bump etc.).
//   - cross-project chip: stash `pendingSessionRestore` in sessionStorage then
//     navigate. The destination host (remounted via key={projectId}) picks the
//     intent up on mount and un-minimizes the group.
//   - popped chip: raise the external OS window (proxy.focus() from this
//     click's user gesture + `group-focus` over the bus for Electron
//     self-raise). A dedicated button on the chip recalls the group back into
//     the main window via `session-windows:recall` / `pendingSessionRecall`.
//
// Close (X) semantics:
//   - same-project chip: dispatch `session-windows:close` so the host's
//     confirmRunningStop prompt still gates the action.
//   - cross-project chip: edit the other project's localStorage entry
//     directly. The underlying PTY is NOT stopped — this is "close the
//     window", not "stop the session". Re-mounting that project shows no
//     window for it; the PTY can be re-attached from the Sessions list.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { GripVertical, X, ExternalLink, Maximize2 } from 'lucide-react';
import { CMD, CMD_FONT } from './terminal-theme';
import { allSessionIds, type LayoutNode } from './group/groupTree';
import { MAIN_WINDOW_ID, openBus, focusPopoutWindow, type PopoutBus } from './popout/popoutBus';
import { useI18n } from '../i18n';
import * as projectsApi from '../api/projects';
import type { Project } from '../types';
import { resolveProjectColor } from '../lib/projectColor';

interface MinimizedChip {
  projectId: string;
  groupId: string;
  sessionIds: string[];
  titles: Record<string, string>;
  // 'minimized' = collapsed floating window; 'popped' = torn out into a
  // separate OS window. Both get a dock chip so the user keeps a handle on it.
  kind: 'minimized' | 'popped';
  // For popped chips: the owning popout window id, used to target it over the bus.
  ownerWindowId?: string;
}

const STORAGE_PREFIX = 'sessionGroups:';
const RESTORE_KEY = 'pendingSessionRestore';
const RECALL_KEY = 'pendingSessionRecall';
// User-defined chip order (array of "projectId:groupId") and the tray's
// horizontal offset, both persisted locally. The tray stays bottom-anchored;
// only `left` is draggable.
const ORDER_KEY = 'sessionDockOrder';
const TRAY_LEFT_KEY = 'sessionDockTray:left';

function chipKeyOf(c: MinimizedChip): string {
  return `${c.projectId}:${c.groupId}`;
}

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function writeOrder(keys: string[]): void {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch { /* ignore */ }
}

function readTrayLeft(): number | null {
  try {
    const raw = localStorage.getItem(TRAY_LEFT_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function writeTrayLeft(v: number): void {
  try { localStorage.setItem(TRAY_LEFT_KEY, String(Math.round(v))); } catch { /* ignore */ }
}

function readAllMinimized(): MinimizedChip[] {
  const chips: MinimizedChip[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const projectId = key.slice(STORAGE_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as {
          groups?: Array<{
            id: string;
            minimized?: boolean;
            root?: LayoutNode;
            ownerWindowId?: string;
          }>;
          titles?: Record<string, string>;
        };
        if (!Array.isArray(parsed.groups)) continue;
        const titles = parsed.titles ?? {};
        for (const g of parsed.groups) {
          if (!g?.root) continue;
          // Popped-out windows are owned by a popout id; surface them as a
          // chip regardless of the (stale) minimized flag. Otherwise only
          // truly-minimized main-owned groups get a chip.
          const popped = !!g.ownerWindowId && g.ownerWindowId !== MAIN_WINDOW_ID;
          if (!popped && !g.minimized) continue;
          chips.push({
            projectId,
            groupId: g.id,
            sessionIds: allSessionIds(g.root),
            titles,
            kind: popped ? 'popped' : 'minimized',
            ownerWindowId: popped ? g.ownerWindowId : undefined,
          });
        }
      } catch { /* skip malformed entry */ }
    }
  } catch { /* localStorage blocked entirely */ }
  chips.sort((a, b) =>
    a.projectId.localeCompare(b.projectId) || a.groupId.localeCompare(b.groupId)
  );
  return chips;
}

function getCurrentProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m ? m[1] : null;
}

export default function GlobalSessionDockTray() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [chips, setChips] = useState<MinimizedChip[]>(() => readAllMinimized());
  const [projectMap, setProjectMap] = useState<Record<string, Project>>({});
  const currentProjectId = getCurrentProjectId(location.pathname);

  const refresh = useCallback(() => setChips(readAllMinimized()), []);

  // Bus handle for posting to popout OS windows (focus). Post-only here.
  const busRef = useRef<PopoutBus | null>(null);
  useEffect(() => {
    const bus = openBus();
    busRef.current = bus;
    return () => { bus.close(); busRef.current = null; };
  }, []);

  // ── Chip reorder (HTML5 drag) ──────────────────────────────────────────
  const [order, setOrder] = useState<string[]>(() => readOrder());
  const dragKeyRef = useRef<string | null>(null);

  const ordered = useMemo(() => {
    const idx = (k: string) => {
      const i = order.indexOf(k);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    // `chips` is already deterministically sorted; this is a stable re-sort
    // that honours the user's drag order and appends unknown chips at the end.
    return [...chips].sort((a, b) => idx(chipKeyOf(a)) - idx(chipKeyOf(b)));
  }, [chips, order]);

  const handleChipDrop = useCallback((targetKey: string) => {
    const from = dragKeyRef.current;
    dragKeyRef.current = null;
    if (!from || from === targetKey) return;
    const keys = ordered.map(chipKeyOf);
    const fi = keys.indexOf(from);
    const ti = keys.indexOf(targetKey);
    if (fi < 0 || ti < 0) return;
    keys.splice(ti, 0, keys.splice(fi, 1)[0]);
    setOrder(keys);
    writeOrder(keys);
  }, [ordered]);

  // ── Tray reposition (pointer drag on grip handle, bottom-anchored) ──────
  const trayRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<number | null>(readTrayLeft());
  const moveRef = useRef<{ startX: number; startLeft: number } | null>(null);
  const [trayLeft, setTrayLeft] = useState<number | null>(() => leftRef.current);

  const onHandleDown = useCallback((e: React.PointerEvent) => {
    const el = trayRef.current;
    if (!el) return;
    e.preventDefault();
    moveRef.current = { startX: e.clientX, startLeft: el.getBoundingClientRect().left };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const onHandleMove = useCallback((e: React.PointerEvent) => {
    const m = moveRef.current;
    if (!m) return;
    const w = trayRef.current?.offsetWidth ?? 200;
    const max = Math.max(8, window.innerWidth - w - 8);
    const next = Math.max(8, Math.min(m.startLeft + (e.clientX - m.startX), max));
    leftRef.current = next;
    setTrayLeft(next);
  }, []);

  const onHandleUp = useCallback((e: React.PointerEvent) => {
    if (!moveRef.current) return;
    moveRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (leftRef.current !== null) writeTrayLeft(leftRef.current);
  }, []);

  // Keep a repositioned tray on-screen when the viewport shrinks.
  useEffect(() => {
    const onResize = () => setTrayLeft((prev) => {
      if (prev === null) return prev;
      const w = trayRef.current?.offsetWidth ?? 200;
      const clamped = Math.max(8, Math.min(prev, window.innerWidth - w - 8));
      if (clamped !== prev) { leftRef.current = clamped; writeTrayLeft(clamped); }
      return clamped;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const load = () => projectsApi.getProjects()
      .then((list) => {
        const map: Record<string, Project> = {};
        for (const p of list) map[p.id] = p;
        setProjectMap(map);
      })
      .catch(() => { /* ignore — falls back to id-hash color */ });
    load();
    window.addEventListener('projects:changed', load);
    return () => window.removeEventListener('projects:changed', load);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // null fires on localStorage.clear(); otherwise only react to ours.
      if (e.key === null || e.key.startsWith(STORAGE_PREFIX)) refresh();
    };
    const onSelf = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('session-windows:changed', onSelf);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('session-windows:changed', onSelf);
    };
  }, [refresh]);

  // Route changes can affect which chips are "current project" (visual
  // emphasis) — re-read so chips that were just minimized in the new project
  // appear without waiting for a separate persist.
  useEffect(() => { refresh(); }, [location.pathname, refresh]);

  if (chips.length === 0) return null;

  const handleRestore = (chip: MinimizedChip) => {
    // Popped chips bring the existing external OS window to the front — no
    // recall into the main app. Two channels, both needed:
    //   1. proxy.focus() on the opener-held WindowProxy. Runs inside this
    //      click's user gesture, which is what lets the browser actually
    //      raise the popup (the popout raising itself is denied without
    //      activation). Unavailable after a main-window reload.
    //   2. `group-focus` over the bus: Electron popouts self-raise through
    //      the main-process IPC bridge, which needs no user activation and
    //      survives main reloads. The bus is global, so this works regardless
    //      of which project is currently open (no navigate needed).
    if (chip.kind === 'popped') {
      if (chip.ownerWindowId) {
        focusPopoutWindow(chip.ownerWindowId);
        busRef.current?.post({ t: 'group-focus', popoutId: chip.ownerWindowId, groupId: chip.groupId });
      }
      return;
    }
    // Minimized chips un-minimize the floating window. Same-project goes through
    // a custom event the host listens for; cross-project stashes an intent and
    // navigates so the destination host picks it up on mount.
    if (chip.projectId === currentProjectId) {
      window.dispatchEvent(new CustomEvent('session-windows:restore', {
        detail: { projectId: chip.projectId, groupId: chip.groupId },
      }));
      return;
    }
    try {
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({
        projectId: chip.projectId, groupId: chip.groupId,
      }));
    } catch { /* private mode; navigation will still happen, just no restore */ }
    navigate(`/projects/${chip.projectId}`);
  };

  // Bring a popped-out group back into the main window ("중앙으로 불러오기").
  // Same-project goes through the host's `session-windows:recall` listener
  // (group-recall handshake + dead-popout fallback live there); cross-project
  // stashes an intent and navigates so the destination host recalls on mount.
  const handleRecall = (chip: MinimizedChip) => {
    if (chip.projectId === currentProjectId) {
      window.dispatchEvent(new CustomEvent('session-windows:recall', {
        detail: { projectId: chip.projectId, groupId: chip.groupId },
      }));
      return;
    }
    try {
      sessionStorage.setItem(RECALL_KEY, JSON.stringify({
        projectId: chip.projectId, groupId: chip.groupId,
      }));
    } catch { /* private mode; navigation will still happen, just no recall */ }
    navigate(`/projects/${chip.projectId}`);
  };

  const handleClose = (chip: MinimizedChip) => {
    if (chip.projectId === currentProjectId) {
      window.dispatchEvent(new CustomEvent('session-windows:close', {
        detail: { projectId: chip.projectId, groupId: chip.groupId },
      }));
      return;
    }
    try {
      const key = STORAGE_PREFIX + chip.projectId;
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          groups?: Array<{ id: string }>;
          [k: string]: unknown;
        };
        if (Array.isArray(parsed.groups)) {
          parsed.groups = parsed.groups.filter(g => g.id !== chip.groupId);
          localStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    } catch { /* ignore — chip just won't disappear until next refresh */ }
    refresh();
  };

  const positioned = trayLeft !== null;

  return createPortal(
    <div
      ref={trayRef}
      // Default (no custom position): offset past the fixed 240px sidebar
      // (w-60) on desktop so chips don't cover its bottom controls; mobile's
      // sidebar is an off-screen overlay so bottom-left is clear. Once the
      // user drags the grip handle, an explicit `left` overrides this.
      className={positioned
        ? 'fixed bottom-2'
        : 'fixed bottom-2 left-2 md:left-[248px] max-w-[calc(100vw-16px)] md:max-w-[calc(100vw-256px)]'}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 900,
        flexWrap: 'wrap',
        ...(positioned
          ? { left: trayLeft, maxWidth: `calc(100vw - ${Math.round(trayLeft) + 8}px)` }
          : {}),
      }}
    >
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        aria-label="move dock"
        style={{
          display: 'flex', alignItems: 'center', flexShrink: 0,
          color: CMD.titleText, cursor: 'grab', padding: 2, touchAction: 'none',
        }}
      >
        <GripVertical size={14} />
      </div>
      {ordered.map((chip) => {
        const labels = chip.sessionIds.map(id => chip.titles[id] || id);
        const label = labels.length === 1
          ? labels[0]
          : `${labels[0]} +${labels.length - 1}`;
        const isOther = chip.projectId !== currentProjectId;
        const isPopped = chip.kind === 'popped';
        return (
          <div
            key={`${chip.projectId}:${chip.groupId}`}
            draggable
            onDragStart={(e) => { dragKeyRef.current = chipKeyOf(chip); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragKeyRef.current && dragKeyRef.current !== chipKeyOf(chip)) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleChipDrop(chipKeyOf(chip)); }}
            onDragEnd={() => { dragKeyRef.current = null; }}
            onClick={() => handleRestore(chip)}
            title={`${isOther ? `[${chip.projectId}] ` : ''}${labels.join(' · ')}${isPopped ? ` — ${t('session.dock.poppedHint')}` : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: CMD.titleBg,
              // Popped chips get a tinted accent border so a separate-window
              // handle reads differently from a plain minimized one.
              border: isPopped ? '1px solid rgba(139,92,246,0.7)' : `1px solid ${CMD.separator}`,
              opacity: isOther ? 0.75 : 1,
              borderRadius: 6,
              padding: '4px 6px 4px 4px',
              fontFamily: CMD_FONT,
              fontSize: 12,
              color: CMD.titleText,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              maxWidth: 240,
              userSelect: 'none',
            }}
          >
            <div
              style={{
                height: 12, width: 12, borderRadius: 3, flexShrink: 0,
                background: projectMap[chip.projectId]
                  ? resolveProjectColor(projectMap[chip.projectId])
                  : resolveProjectColor({ id: chip.projectId }),
              }}
            />
            {isPopped && <ExternalLink size={11} style={{ flexShrink: 0, color: 'rgb(167,139,250)' }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {label}
            </span>
            {isPopped && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRecall(chip); }}
                aria-label="recall"
                title={t('session.recallToMain')}
                style={{
                  background: 'transparent', border: 'none', color: 'rgb(167,139,250)',
                  cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', borderRadius: 3,
                }}
              >
                <Maximize2 size={11} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleClose(chip); }}
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
  );
}
