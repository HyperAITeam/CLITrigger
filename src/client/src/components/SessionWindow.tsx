// Floating window chrome wrapping a group's layout tree. The window
// itself is one OpenGroup (id, geometry, root layout, colors, intents).
// Chrome handles: group drag (with Aero edge snap + neighbor sticky snap),
// corner resize, viewport clamp, group minimize/close. The body of the
// window delegates to LayoutNodeView, which recursively renders the tree.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Minus } from 'lucide-react';
import LayoutNodeView from './group/LayoutNodeView';
import StackView from './group/StackView';
import DockOverlay, { detectDockZone, type DockTargetRect } from './group/DockOverlay';
import { CMD, CMD_FONT } from './terminal-theme';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n';
import { activeSessionIds, allSessionIds } from './group/groupTree';
import { useSessionWindows, type OpenGroup } from './SessionWindowsHost';
import SessionPane from './group/SessionPane';
import type { Path, DockSide } from './group/groupTree';
import type { Session } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';

interface Geometry { x: number; y: number; w: number; h: number; }

interface SessionWindowProps {
  group: OpenGroup;
  sessionsById: Map<string, Session>;
  neighbors: Geometry[];
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

const MIN_W = 320;
const MIN_H = 200;
const TITLEBAR_VISIBLE = 80;
const CHROME_HEIGHT = 22;
const COLOR_BAND_HEIGHT = 4;
const SNAP_EDGE_THRESHOLD = 8;
const SNAP_NEIGHBOR_THRESHOLD = 10;

type SnapZone = 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function detectSnapZone(mx: number, my: number, vpW: number, vpH: number): SnapZone | null {
  const nearLeft = mx <= SNAP_EDGE_THRESHOLD;
  const nearRight = mx >= vpW - SNAP_EDGE_THRESHOLD;
  if (!nearLeft && !nearRight) return null;
  const topThird = vpH / 3;
  const bottomThird = (vpH * 2) / 3;
  if (nearLeft) {
    if (my < topThird) return 'top-left';
    if (my > bottomThird) return 'bottom-left';
    return 'left';
  }
  if (my < topThird) return 'top-right';
  if (my > bottomThird) return 'bottom-right';
  return 'right';
}

function snapZoneToGeom(zone: SnapZone, vpW: number, vpH: number): Geometry {
  const halfW = Math.round(vpW / 2);
  const halfH = Math.round(vpH / 2);
  switch (zone) {
    case 'left': return { x: 0, y: 0, w: halfW, h: vpH };
    case 'right': return { x: vpW - halfW, y: 0, w: halfW, h: vpH };
    case 'top-left': return { x: 0, y: 0, w: halfW, h: halfH };
    case 'top-right': return { x: vpW - halfW, y: 0, w: halfW, h: halfH };
    case 'bottom-left': return { x: 0, y: vpH - halfH, w: halfW, h: halfH };
    case 'bottom-right': return { x: vpW - halfW, y: vpH - halfH, w: halfW, h: halfH };
  }
}

function applyNeighborSnap(nx: number, ny: number, w: number, h: number, neighbors: Geometry[]): { x: number; y: number } {
  let x = nx, y = ny;
  const left = x, right = x + w, top = y, bottom = y + h;
  for (const n of neighbors) {
    const nLeft = n.x, nRight = n.x + n.w, nTop = n.y, nBottom = n.y + n.h;
    const vOverlap = top < nBottom && bottom > nTop;
    if (vOverlap) {
      if (Math.abs(left - nRight) <= SNAP_NEIGHBOR_THRESHOLD) x = nRight;
      else if (Math.abs(right - nLeft) <= SNAP_NEIGHBOR_THRESHOLD) x = nLeft - w;
      else if (Math.abs(left - nLeft) <= SNAP_NEIGHBOR_THRESHOLD) x = nLeft;
      else if (Math.abs(right - nRight) <= SNAP_NEIGHBOR_THRESHOLD) x = nRight - w;
    }
    const hOverlap = left < nRight && right > nLeft;
    if (hOverlap) {
      if (Math.abs(top - nBottom) <= SNAP_NEIGHBOR_THRESHOLD) y = nBottom;
      else if (Math.abs(bottom - nTop) <= SNAP_NEIGHBOR_THRESHOLD) y = nTop - h;
      else if (Math.abs(top - nTop) <= SNAP_NEIGHBOR_THRESHOLD) y = nTop;
      else if (Math.abs(bottom - nBottom) <= SNAP_NEIGHBOR_THRESHOLD) y = nBottom - h;
    }
  }
  return { x, y };
}

export default function SessionWindow({
  group,
  sessionsById,
  neighbors,
  sendMessage,
  subscribeBinary,
  onEvent,
}: SessionWindowProps) {
  const { t } = useI18n();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const api = useSessionWindows();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const geomRef = useRef<Geometry>({ x: group.x, y: group.y, w: group.w, h: group.h });
  geomRef.current = { x: group.x, y: group.y, w: group.w, h: group.h };
  const [snapZone, setSnapZone] = useState<SnapZone | null>(null);
  const snapZoneRef = useRef<SnapZone | null>(null);
  const neighborsRef = useRef<Geometry[]>(neighbors);
  neighborsRef.current = neighbors;
  // Dock hover preview (only used by single-stack chrome drag)
  const [dockHover, setDockHover] = useState<{ rect: DockTargetRect; zone: DockSide | null } | null>(null);
  const dockHoverRef = useRef<{ groupId: string; path: Path; rect: DockTargetRect; zone: DockSide | null } | null>(null);

  // ── Chrome drag (group move + optional dock detection) ────────────────────
  // `detectDock=true`: also sample other groups' stacks under the cursor and
  //   commit a `dockGroup` on mouseup if the user dropped on a dock zone.
  //   Used for single-stack groups where the entire window is the chrome.
  // `detectDock=false`: pure group move with edge-snap preview. Used for the
  //   unified chrome of split groups (which should not dock further).
  const startGroupChromeDrag = useCallback((e: React.MouseEvent<HTMLDivElement>, detectDock: boolean) => {
    if (isMobile) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag]')) return;
    e.preventDefault();
    api.focus(allSessionIds(group.root)[0] || '');
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startGeom = { ...geomRef.current };
    const wrapper = wrapperRef.current;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    // For dock detection we need elementFromPoint to see *other* groups'
    // stacks. Since this very window is being dragged under the cursor,
    // it would otherwise hit-test as itself every frame and shadow the
    // destination underneath. Disable our own pointer events for the
    // duration of the drag — mousemove/mouseup are window-level
    // listeners so the gesture isn't affected.
    let prevPointerEvents = '';
    if (detectDock && wrapper) {
      prevPointerEvents = wrapper.style.pointerEvents;
      wrapper.style.pointerEvents = 'none';
    }
    const restorePointerEvents = () => {
      if (detectDock && wrapper) {
        wrapper.style.pointerEvents = prevPointerEvents;
      }
    };

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startMouseX;
      const dy = ev.clientY - startMouseY;
      let nx = clamp(startGeom.x + dx, -(startGeom.w - TITLEBAR_VISIBLE), vpW - TITLEBAR_VISIBLE);
      let ny = clamp(startGeom.y + dy, 0, vpH - CHROME_HEIGHT);
      const ns = neighborsRef.current;
      if (ns.length > 0) {
        const snapped = applyNeighborSnap(nx, ny, startGeom.w, startGeom.h, ns);
        nx = snapped.x; ny = snapped.y;
      }
      if (wrapper) {
        wrapper.style.left = `${nx}px`;
        wrapper.style.top = `${ny}px`;
      }
      geomRef.current.x = nx;
      geomRef.current.y = ny;

      // Dock zone detection (single-stack groups only). Skip when the cursor
      // is over our own group's stack — we don't dock a group into itself.
      if (detectDock) {
        let hover: { groupId: string; path: Path; rect: DockTargetRect; zone: DockSide | null } | null = null;
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const stackEl = el?.closest('[data-group-id][data-stack-path]') as HTMLElement | null;
        if (stackEl) {
          const gid = stackEl.dataset.groupId || '';
          if (gid !== group.id) {
            const pathStr = stackEl.dataset.stackPath || '';
            const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
            const r = stackEl.getBoundingClientRect();
            const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
            hover = { groupId: gid, path, rect, zone: detectDockZone(ev.clientX, ev.clientY, rect) };
          }
        }
        dockHoverRef.current = hover;
        setDockHover(hover ? { rect: hover.rect, zone: hover.zone } : null);
      }

      // Edge-snap preview only when not actively docking onto another stack.
      const dockActive = detectDock && dockHoverRef.current && dockHoverRef.current.zone;
      const edgeZone = dockActive ? null : detectSnapZone(ev.clientX, ev.clientY, vpW, vpH);
      if (edgeZone !== snapZoneRef.current) {
        snapZoneRef.current = edgeZone;
        setSnapZone(edgeZone);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      restorePointerEvents();
      // Resolution priority: dock > edge snap > free move.
      if (detectDock && dockHoverRef.current && dockHoverRef.current.zone) {
        const dh = dockHoverRef.current;
        api.dockGroup(group.id, dh.groupId, dh.path, dh.zone!);
        dockHoverRef.current = null;
        setDockHover(null);
        snapZoneRef.current = null;
        setSnapZone(null);
        return; // group dissolved into dst — no geometry commit needed
      }
      if (snapZoneRef.current) {
        const target = snapZoneToGeom(snapZoneRef.current, vpW, vpH);
        if (wrapper) {
          wrapper.style.left = `${target.x}px`;
          wrapper.style.top = `${target.y}px`;
          wrapper.style.width = `${target.w}px`;
          wrapper.style.height = `${target.h}px`;
        }
        geomRef.current = target;
        snapZoneRef.current = null;
        setSnapZone(null);
      }
      dockHoverRef.current = null;
      setDockHover(null);
      api.setGroupGeometry(group.id, { ...geomRef.current });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, api, group.id, group.root]);

  const onChromeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => startGroupChromeDrag(e, false),
    [startGroupChromeDrag],
  );
  const onChromeWithDockMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => startGroupChromeDrag(e, true),
    [startGroupChromeDrag],
  );

  // ── Resize (bottom-right corner) ─────────────────────────────────────────
  const onResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startGeom = { ...geomRef.current };
    const wrapper = wrapperRef.current;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    const onMove = (ev: MouseEvent) => {
      const dw = ev.clientX - startMouseX;
      const dh = ev.clientY - startMouseY;
      const maxW = vpW - startGeom.x;
      const maxH = vpH - startGeom.y;
      const nw = clamp(startGeom.w + dw, MIN_W, Math.max(MIN_W, maxW));
      const nh = clamp(startGeom.h + dh, MIN_H, Math.max(MIN_H, maxH));
      if (wrapper) {
        wrapper.style.width = `${nw}px`;
        wrapper.style.height = `${nh}px`;
      }
      geomRef.current.w = nw;
      geomRef.current.h = nh;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.setGroupGeometry(group.id, { ...geomRef.current });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, api, group.id]);

  // ── Viewport resize re-clamp ─────────────────────────────────────────────
  useEffect(() => {
    if (isMobile) return;
    const onResize = () => {
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const cur = geomRef.current;
      const nx = clamp(cur.x, -(cur.w - TITLEBAR_VISIBLE), vpW - TITLEBAR_VISIBLE);
      const ny = clamp(cur.y, 0, vpH - CHROME_HEIGHT);
      if (nx !== cur.x || ny !== cur.y) {
        api.setGroupGeometry(group.id, { ...cur, x: nx, y: ny });
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isMobile, api, group.id]);

  // ── Tab callbacks (delegated to host) ────────────────────────────────────
  const handleTabClick = useCallback((sid: string) => {
    api.setActiveTab(group.id, sid);
  }, [api, group.id]);
  const handleTabClose = useCallback((sid: string) => {
    api.close(sid);
  }, [api]);
  const handleTabMouseDown = useCallback((sid: string, path: Path, e: React.MouseEvent) => {
    api.beginTabDrag(group.id, sid, path, e);
  }, [api, group.id]);
  const handlePaneAutoClose = useCallback((sid: string) => {
    api.close(sid);
  }, [api]);
  const handleSplitSizes = useCallback((path: Path, sizes: number[]) => {
    api.setSplitSizes(group.id, path, sizes);
  }, [api, group.id]);

  const activeIds = activeSessionIds(group.root);
  const allIds = allSessionIds(group.root);

  // ── Mobile: fullscreen single active session, no chrome interactions ─────
  if (isMobile) {
    const activeId = activeIds[0];
    const session = activeId ? sessionsById.get(activeId) : null;
    if (!session) return null;
    const intentInfo = group.intents[activeId] ?? { intent: 'open' as const, nonce: 0 };
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, background: CMD.bg, display: 'flex', flexDirection: 'column', zIndex: 110 }}>
        <div
          style={{
            background: CMD.titleBg, height: CHROME_HEIGHT,
            display: 'flex', alignItems: 'center', borderBottom: `1px solid ${CMD.separator}`,
          }}
        >
          <span style={{ flex: 1, color: CMD.titleText, fontFamily: CMD_FONT, fontSize: 12, paddingLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title}
          </span>
          <button data-no-drag onClick={() => api.closeGroup(group.id)} style={closeBtnStyle} aria-label="close">
            <X size={14} />
          </button>
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <SessionPane
            session={session}
            visible
            intent={intentInfo.intent}
            intentNonce={intentInfo.nonce}
            onClose={() => api.close(activeId)}
            sendMessage={sendMessage}
            subscribeBinary={subscribeBinary}
            onEvent={onEvent}
          />
        </div>
      </div>,
      document.body,
    );
  }

  // ── Desktop: floating, draggable, resizable, with group chrome ───────────
  const snapPreview = snapZone ? (() => {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const target = snapZoneToGeom(snapZone, vpW, vpH);
    return createPortal(
      <div
        style={{
          position: 'fixed',
          left: target.x, top: target.y, width: target.w, height: target.h,
          background: `${CMD.info}33`,
          border: `2px dashed ${CMD.info}`,
          borderRadius: 8,
          pointerEvents: 'none',
          zIndex: 2000,
          transition: 'left 80ms ease-out, top 80ms ease-out, width 80ms ease-out, height 80ms ease-out',
          boxSizing: 'border-box',
        }}
      />,
      document.body,
    );
  })() : null;

  // Group label: single-tab → that tab's title; multi-tab → first title + count
  const groupLabel = (() => {
    if (allIds.length === 0) return '';
    const first = sessionsById.get(allIds[0])?.title || allIds[0];
    if (allIds.length === 1) return first;
    return `${first} +${allIds.length - 1}`;
  })();

  // The unified group chrome only appears once the group has been split
  // (i.e. it actually contains multiple stacks). For a single-stack group
  // the chrome would just duplicate the stack's tab bar, so we hide it and
  // let the stack's tab bar host the group's minimize/close buttons.
  const isSplitRoot = group.root.kind === 'split';

  const desktopWindow = createPortal(
    <div
      ref={wrapperRef}
      onMouseDown={isSplitRoot ? () => api.focus(allIds[0] || '') : onChromeWithDockMouseDown}
      style={{
        position: 'fixed',
        left: group.x, top: group.y, width: group.w, height: group.h,
        zIndex: group.z,
        background: CMD.bg,
        border: `1px solid ${CMD.separator}`,
        borderRadius: 8,
        boxShadow: '0 10px 40px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {isSplitRoot && (
        /* Unified chrome: color band + group label + minimize/close.
           Shown only when the group is actually a multi-stack arrangement. */
        <div
          onMouseDown={onChromeMouseDown}
          style={{
            height: CHROME_HEIGHT, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            background: CMD.titleBg,
            borderBottom: `1px solid ${CMD.separator}`,
            userSelect: 'none', cursor: 'move',
          }}
        >
          <div style={{ display: 'flex', height: COLOR_BAND_HEIGHT, flexShrink: 0 }}>
            {activeIds.map((id, idx) => (
              <div key={idx} style={{ flex: 1, background: group.colors[id] || CMD.titleText }} />
            ))}
          </div>
          <div
            style={{
              flex: 1, display: 'flex', alignItems: 'center',
              padding: '0 4px 0 8px', color: CMD.titleText, fontFamily: CMD_FONT, fontSize: 11,
            }}
          >
            <span style={{ color: CMD.info, fontWeight: 600, letterSpacing: 1, marginRight: 8 }} aria-hidden>{'>_'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {groupLabel}
            </span>
            <button
              data-no-drag
              onClick={() => api.minimizeGroup(group.id)}
              style={closeBtnStyle}
              aria-label="minimize"
              title={t('session.minimize') || 'Minimize'}
            >
              <Minus size={14} />
            </button>
            <button
              data-no-drag
              onClick={() => api.closeGroup(group.id)}
              style={closeBtnStyle}
              aria-label="close"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {/* Layout body */}
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
            registerRect={() => { /* hit-test uses elementFromPoint, no registry needed */ }}
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
            groupActions={{
              onMinimizeGroup: () => api.minimizeGroup(group.id),
              onCloseGroup: () => api.closeGroup(group.id),
            }}
          />
        )}
      </div>
      {/* Resize corner */}
      <div
        onMouseDown={onResizeMouseDown}
        title="resize"
        style={{
          position: 'absolute', right: 0, bottom: 0,
          width: 14, height: 14, cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%)',
          zIndex: 3,
        }}
      />
    </div>,
    document.body,
  );

  return (
    <>
      {desktopWindow}
      {snapPreview}
      {dockHover && <DockOverlay targetRect={dockHover.rect} activeZone={dockHover.zone} />}
    </>
  );
}

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: CMD.titleText,
  cursor: 'pointer',
  padding: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 4,
};
