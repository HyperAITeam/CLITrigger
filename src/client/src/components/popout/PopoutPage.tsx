// Child OS-window entry point. Opened via window.open() from the main app
// when the user clicks a group's "Pop out" button. Renders exactly one
// OpenGroup full-screen, with a thin top bar carrying only the group label
// and a "Re-dock to main" button. OS-window chrome (move/resize/min/max) is
// handled by the OS / browser; this component intentionally does not
// implement React-side drag or resize.
//
// Communication with the main window goes through `popoutBus` (a project-
// scoped BroadcastChannel):
//   - mount: post `hello` → main responds with `group-handoff`
//   - active-tab / split-size changes: post `group-update` patches
//   - close tab → if last tab gone, post `group-close` (main also drops it)
//   - Re-dock click: post `group-return` with current OpenGroup payload, then
//     window.close()
//   - beforeunload: post `bye` so main reclaims ownership immediately
//   - heartbeat every HEARTBEAT_MS so main can detect a crashed popout

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import StackView from '../group/StackView';
import LayoutNodeView from '../group/LayoutNodeView';
import DockOverlay, { detectDockZone, type DockTargetRect } from '../group/DockOverlay';
import { CMD, CMD_FONT } from '../terminal-theme';
import * as sessionsApi from '../../api/sessions';
import { useI18n } from '../../i18n';
import {
  openBus,
  holdPopoutLock,
  HEARTBEAT_MS,
  type BusMessage,
} from './popoutBus';
import {
  type LayoutNode,
  type Path,
  type DockSide,
  allSessionIds,
  dockTab,
  getNode,
  removeTab,
  setActiveTab as treeSetActiveTab,
  setSplitSizes as treeSetSplitSizes,
} from '../group/groupTree';
import type { Session } from '../../types';
import type { WsEvent } from '../../hooks/useWebSocket';
import type { PaneIntent } from '../group/SessionPane';

interface PopoutPageProps {
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

// Minimal mirror of OpenGroup for popout-local state. We avoid importing
// the host's OpenGroup type to keep this module standalone.
interface PopoutGroup {
  id: string;
  z: number;
  minimized: boolean;
  x: number; y: number; w: number; h: number;
  root: LayoutNode;
  colors: Record<string, string>;
  intents: Record<string, { intent: PaneIntent; nonce: number }>;
  ownerWindowId: string;
}

const CHROME_HEIGHT = 28;

export default function PopoutPage({ sendMessage, subscribeBinary, onEvent }: PopoutPageProps) {
  const { projectId = '', groupId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const popoutId = searchParams.get('wid') || '';
  const { t } = useI18n();

  const [group, setGroup] = useState<PopoutGroup | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Set when main broadcasts `group-reclaimed` for our popoutId — main has
  // declared this popout dead (missed heartbeats / background throttle) and
  // moved ownership back to itself. We must stop rendering immediately so
  // the same session isn't being written to two xterm instances, then close
  // the OS window after a short user-visible notice.
  const [reclaimedNotice, setReclaimedNotice] = useState<string | null>(null);
  const groupRef = useRef<PopoutGroup | null>(null);
  groupRef.current = group;
  const busRef = useRef<ReturnType<typeof openBus> | null>(null);

  // Fetch the project's session list once for label/status rendering.
  // SessionPane uses session.status to pick its phase, so this is required
  // even though the group payload from main names the session ids.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    sessionsApi.getSessions(projectId)
      .then((list) => { if (!cancelled) setSessions(list); })
      .catch((err) => { if (!cancelled) setError(String(err?.message || err)); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Cross-project groups: the handed-off group may contain sessions docked in
  // from OTHER projects, which the project-scoped list above can't see. Fetch
  // each missing id individually and merge, so their panes render instead of
  // staying blank. Failed lookups (deleted sessions) are simply skipped — the
  // pane renders null, same as before this feature.
  const fetchedForeignRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!group || sessions.length === 0) return;
    const known = new Set(sessions.map(s => s.id));
    for (const id of allSessionIds(group.root)) {
      if (known.has(id) || fetchedForeignRef.current.has(id)) continue;
      fetchedForeignRef.current.add(id);
      sessionsApi.getSession(id)
        .then((s) => setSessions((prev) => prev.some(p => p.id === s.id) ? prev : [...prev, s]))
        .catch(() => { /* deleted or unreachable — pane stays empty */ });
    }
  }, [group, sessions]);

  // Live-update the local sessions list from WS events so the popout sees
  // status transitions (running → stopped) without polling — SessionPane's
  // auto-close fires when status leaves running. Mirrors the incremental
  // patch pattern in ProjectDetail (no full refetch). The only session
  // mutation WS event the server actually emits is `session:status-changed`;
  // creation/deletion arrive via REST in this UI.
  useEffect(() => {
    const unsub = onEvent((event) => {
      if (event.type === 'session:status-changed' && event.sessionId) {
        setSessions((prev) => prev.map((s) => {
          if (s.id !== event.sessionId) return s;
          const patch: Partial<Session> = {
            status: event.status as Session['status'],
            updated_at: new Date().toISOString(),
          };
          if (event.worktree_path !== undefined) patch.worktree_path = event.worktree_path;
          if (event.branch_name !== undefined) patch.branch_name = event.branch_name;
          return { ...s, ...patch };
        }));
      }
    });
    return unsub;
  }, [onEvent]);

  // Bus: open, hello on mount, handle handoff. Heartbeat. beforeunload bye.
  useEffect(() => {
    if (!projectId || !groupId || !popoutId) return;
    const bus = openBus();
    busRef.current = bus;
    const unsub = bus.subscribe((msg: BusMessage) => {
      if (msg.t === 'group-handoff' && msg.to === popoutId && msg.groupId === groupId) {
        const payload = msg.group as PopoutGroup;
        // Reset geometry to fill the popout's own viewport — the OS window
        // is now in charge of size; the original main-window coords would
        // render mostly off-screen if we kept them.
        setGroup({
          ...payload,
          x: 0, y: 0,
          w: window.innerWidth,
          h: Math.max(0, window.innerHeight - CHROME_HEIGHT),
          minimized: false,
          ownerWindowId: popoutId,
        });
      } else if (msg.t === 'group-recall' && msg.popoutId === popoutId && msg.groupId === groupId) {
        // User clicked "bring to main window" from the main app. Behave just
        // like the Re-dock button: return the latest payload, then close.
        const g = groupRef.current;
        if (g) bus.post({ t: 'group-return', from: popoutId, groupId: g.id, group: g, projectId });
        setTimeout(() => { try { window.close(); } catch { /* blocked */ } }, 50);
      } else if (msg.t === 'group-reclaimed' && msg.popoutId === popoutId) {
        // Main reclaimed our ownership. Drop the group immediately so the
        // StackView → SessionPane → SessionTerminal tree unmounts and the
        // binary subscription is released; otherwise main's freshly-mounted
        // SessionTerminal for the same session would share the WS callback
        // set and both xterm instances would receive every frame. Then
        // surface a short notice and close the OS window so the user sees
        // what happened instead of an empty popout.
        setGroup(null);
        setReclaimedNotice(
          t('session.popout.reclaimed')
          || '메인 윈도우가 이 터미널을 회수했습니다. 잠시 후 창이 닫힙니다.'
        );
        setTimeout(() => { try { window.close(); } catch { /* blocked */ } }, 1500);
      }
    });
    bus.post({ t: 'hello', from: popoutId, groupId });

    // Hold a Web Lock for this window's lifetime. Unlike the heartbeat below,
    // it is immune to background timer throttling — main checks it before
    // reclaiming us, so a backgrounded-but-alive popout is never pulled back.
    // Released automatically on real close/crash, or by releaseLock() on unmount.
    const releaseLock = holdPopoutLock(popoutId);

    const beat = setInterval(() => {
      const g = groupRef.current;
      bus.post({ t: 'heartbeat', from: popoutId, ownedGroupIds: g ? [g.id] : [groupId] });
    }, HEARTBEAT_MS);

    const onBeforeUnload = () => {
      const g = groupRef.current;
      // Best-effort: post both group-return (with payload) and bye.
      // BroadcastChannel.postMessage is synchronous so this lands before
      // teardown completes in typical browsers.
      if (g) {
        bus.post({
          t: 'group-return',
          from: popoutId,
          groupId: g.id,
          group: g,
          projectId,
        });
      }
      bus.post({ t: 'bye', from: popoutId });
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      clearInterval(beat);
      releaseLock();
      window.removeEventListener('beforeunload', onBeforeUnload);
      unsub();
      bus.close();
      busRef.current = null;
    };
  }, [projectId, groupId, popoutId]);

  // Mirror local state changes back to main as group-update patches so a
  // cold reload of main preserves the popout's edits (active tab, split
  // sizes). Coarse: send the whole tree + colors + intents on each change.
  // No-op until the handoff has populated `group`.
  const postUpdate = useCallback((patch: Partial<PopoutGroup>) => {
    if (!busRef.current || !groupRef.current) return;
    busRef.current.post({
      t: 'group-update',
      from: popoutId,
      groupId: groupRef.current.id,
      patch,
    });
  }, [popoutId]);

  // ── Tab callbacks ────────────────────────────────────────────────────────
  const handleTabClick = useCallback((sid: string) => {
    setGroup((prev) => {
      if (!prev) return prev;
      const next: PopoutGroup = { ...prev, root: treeSetActiveTab(prev.root, sid) };
      postUpdate({ root: next.root });
      return next;
    });
  }, [postUpdate]);

  const handleTabClose = useCallback((sid: string) => {
    const session = sessions.find(s => s.id === sid);
    if (session?.status === 'running') {
      if (!window.confirm(t('session.confirmStop') || 'Stop this running session?')) return;
      sessionsApi.stopSession(sid).catch(() => { /* swallow */ });
    }
    setGroup((prev) => {
      if (!prev) return prev;
      const newRoot = removeTab(prev.root, sid);
      if (!newRoot) {
        // Last tab in the popout — close the OS window. Main was already
        // told via group-close; the bus listener on main side will drop it.
        busRef.current?.post({ t: 'group-close', from: popoutId, groupId: prev.id });
        setTimeout(() => window.close(), 50);
        return null;
      }
      const remaining = new Set(allSessionIds(newRoot));
      const colors: Record<string, string> = {};
      for (const k of Object.keys(prev.colors)) if (remaining.has(k)) colors[k] = prev.colors[k];
      const intents: Record<string, { intent: PaneIntent; nonce: number }> = {};
      for (const k of Object.keys(prev.intents)) if (remaining.has(k)) intents[k] = prev.intents[k];
      const next: PopoutGroup = { ...prev, root: newRoot, colors, intents };
      postUpdate({ root: next.root, colors: next.colors, intents: next.intents });
      return next;
    });
  }, [sessions, t, postUpdate, popoutId]);

  // ── In-popout tab drag → dock ────────────────────────────────────────────
  //
  // Same-tree docking only: drag a tab over any stack (including its own) and
  // drop on a dock zone to move it / create a split — the same gesture the
  // main window offers. There is no tear-out: a popout IS already a separate
  // OS window, and cross-window drag isn't possible with DOM mouse events.
  // Unlike main, docking onto the tab's OWN stack with a side zone is allowed
  // (that's how a single-stack popout creates its first split; main does this
  // via the floating-window detach intermediate, which doesn't exist here).
  const [drag, setDrag] = useState<{
    sessionId: string;
    fromPath: Path;
    hoveredPath: Path | null;
    hoveredRect: DockTargetRect | null;
    zone: DockSide | null;
  } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;

  const DRAG_THRESHOLD = 6;
  const handleTabMouseDown = useCallback((sessionId: string, fromPath: Path, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (!groupRef.current) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;

    const onMove = (ev: MouseEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
      }
      let hoveredPath: Path | null = null;
      let hoveredRect: DockTargetRect | null = null;
      let zone: DockSide | null = null;
      const els = document.elementsFromPoint(ev.clientX, ev.clientY) as HTMLElement[];
      for (const node of els) {
        const cand = node.closest('[data-group-id][data-stack-path]') as HTMLElement | null;
        if (!cand) continue;
        const pathStr = cand.dataset.stackPath || '';
        const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
        const isSelf = pathStr === fromPath.join('.');
        if (isSelf) {
          // Splitting the own stack needs a sibling tab to stay behind;
          // a 1-tab stack has nothing to split against.
          const cur = groupRef.current;
          const srcNode = cur ? getNode(cur.root, fromPath) : null;
          if (!srcNode || srcNode.kind !== 'stack' || srcNode.tabs.length < 2) break;
        }
        const r = cand.getBoundingClientRect();
        hoveredPath = path;
        hoveredRect = { x: r.left, y: r.top, w: r.width, h: r.height };
        zone = detectDockZone(ev.clientX, ev.clientY, hoveredRect);
        // Center on the own stack is a no-op re-insert — don't light it up.
        if (isSelf && zone === 'center') zone = null;
        break;
      }
      setDrag({ sessionId, fromPath, hoveredPath, hoveredRect, zone });
    };

    let cleaned = false;
    const detach = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onAbort);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
    };
    const onAbort = () => { detach(); setDrag(null); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onAbort(); };
    const onVis = () => { if (document.hidden) onAbort(); };
    const onUp = () => {
      detach();
      const cur = dragRef.current;
      setDrag(null);
      if (!cur || !cur.hoveredPath || !cur.zone) return;
      const g = groupRef.current;
      if (!g) return;
      const newRoot = dockTab(g.root, cur.sessionId, cur.hoveredPath, cur.zone);
      if (!newRoot) return;
      setGroup({ ...g, root: newRoot });
      postUpdate({ root: newRoot });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onAbort);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
  }, [postUpdate]);

  const handlePaneAutoClose = useCallback((sid: string) => {
    handleTabClose(sid);
  }, [handleTabClose]);

  const handleSplitSizes = useCallback((path: Path, sizes: number[]) => {
    setGroup((prev) => {
      if (!prev) return prev;
      const next: PopoutGroup = { ...prev, root: treeSetSplitSizes(prev.root, path, sizes) };
      postUpdate({ root: next.root });
      return next;
    });
  }, [postUpdate]);

  // Re-dock: hand the group back to main, then close ourselves. The main
  // host's bus listener for group-return restores ownership and re-renders.
  const handleReDock = useCallback(() => {
    const g = groupRef.current;
    if (!g || !busRef.current) { window.close(); return; }
    busRef.current.post({
      t: 'group-return',
      from: popoutId,
      groupId: g.id,
      group: g,
      projectId,
    });
    // Tiny delay so the BroadcastChannel message flushes before unload.
    setTimeout(() => window.close(), 50);
  }, [popoutId, projectId]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div style={pageErrorStyle}>
        <p>{t('session.popout.loadFailed') || 'Failed to load popout window.'}</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>{error}</p>
      </div>
    );
  }
  if (!group) {
    // Reclaim notice trumps the generic "waiting for handoff" message: the
    // window WILL self-close in ~1.5s, no user action needed.
    if (reclaimedNotice) {
      return (
        <div style={pageErrorStyle}>
          <p>{reclaimedNotice}</p>
        </div>
      );
    }
    return (
      <div style={pageErrorStyle}>
        <p>{t('session.popout.waiting') || 'Waiting for main window…'}</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          {t('session.popout.waitingHint') || 'If the main app is not open, this window cannot start. Open the project in the main app and try Pop Out again.'}
        </p>
      </div>
    );
  }

  const allIds = allSessionIds(group.root);
  const firstTitle = allIds.length > 0 ? (sessionsById.get(allIds[0])?.title || allIds[0]) : '';
  const groupLabel = allIds.length === 1
    ? firstTitle
    : `${firstTitle} +${allIds.length - 1}`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: CMD.bg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: CHROME_HEIGHT,
          background: CMD.titleBg,
          borderBottom: `1px solid ${CMD.separator}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 4px 0 10px',
          color: CMD.titleText,
          fontFamily: CMD_FONT,
          fontSize: 11,
          flexShrink: 0,
          userSelect: 'none',
          // Frameless Electron popout: this bar is the window drag handle.
          // Ignored in plain web browsers.
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <span style={{ color: CMD.info, fontWeight: 600, letterSpacing: 1, marginRight: 8 }} aria-hidden>{'>_'}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {groupLabel}
        </span>
        <button
          onClick={handleReDock}
          style={chromeBtnStyle}
          aria-label="redock"
          title={t('session.popout.redock') || 'Re-dock to main window'}
        >
          <ExternalLink size={13} style={{ transform: 'scaleX(-1)' }} />
          <span style={{ marginLeft: 4 }}>{t('session.popout.redockShort') || 'Re-dock'}</span>
        </button>
        <button
          onClick={() => window.close()}
          style={chromeBtnStyle}
          aria-label="close-popout"
          title={t('session.popout.closeWindow') || 'Close window'}
        >
          <X size={13} />
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
        {group.root.kind === 'split' ? (
          <LayoutNodeView
            node={group.root}
            path={[]}
            groupId={group.id}
            sessionsById={sessionsById}
            colors={group.colors}
            intents={group.intents}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabMouseDown={handleTabMouseDown}
            onPaneAutoClose={handlePaneAutoClose}
            registerRect={() => { /* hit-test not used in popout */ }}
            onSplitSizes={handleSplitSizes}
            sendMessage={sendMessage}
            subscribeBinary={subscribeBinary}
            onEvent={onEvent}
          />
        ) : (
          <StackView
            stack={group.root}
            path={[]}
            groupId={group.id}
            sessionsById={sessionsById}
            colors={group.colors}
            intents={group.intents}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabMouseDown={handleTabMouseDown}
            onPaneAutoClose={handlePaneAutoClose}
            registerRect={() => { /* unused */ }}
            sendMessage={sendMessage}
            subscribeBinary={subscribeBinary}
            onEvent={onEvent}
            // No groupActions in the popout — OS provides min/close, and a
            // popout can't pop itself out further.
          />
        )}
      </div>
      {/* Tab drag visual: dock overlay over the hovered stack */}
      {drag && drag.hoveredRect && (
        <DockOverlay targetRect={drag.hoveredRect} activeZone={drag.zone} />
      )}
    </div>
  );
}

const pageErrorStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: CMD.bg,
  color: CMD.titleText,
  fontFamily: CMD_FONT,
  fontSize: 12,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 24,
  textAlign: 'center',
};

const chromeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: CMD.titleText,
  cursor: 'pointer',
  padding: '4px 8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  fontFamily: CMD_FONT,
  fontSize: 11,
  // Keep buttons clickable inside the drag-region top bar (frameless popout).
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;
