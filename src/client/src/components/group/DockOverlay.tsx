// 5-zone diamond dock indicator (Visual Studio-style). Rendered via portal at
// document.body so it overlays everything including the dragged window.
//
// The host computes which zone the mouse is over (via `detectDockZone`) and
// passes it in. This component is purely visual: the diamond + drop preview
// rectangle inside the target stack's content area.

import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import { CMD } from '../terminal-theme';
import type { DockSide } from './groupTree';

export interface DockTargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DockOverlayProps {
  targetRect: DockTargetRect;
  activeZone: DockSide | null;
}

const ARM_SIZE = 28;     // half-side of each zone icon (icon = 56x56)
const ARM_OFFSET = 68;   // distance from diamond center to side icons

export function detectDockZone(
  mouseX: number,
  mouseY: number,
  rect: DockTargetRect,
): DockSide | null {
  const cx = mouseX - rect.x;
  const cy = mouseY - rect.y;
  if (cx < 0 || cy < 0 || cx > rect.w || cy > rect.h) return null;
  const dx = cx - rect.w / 2;
  const dy = cy - rect.h / 2;
  if (Math.abs(dx) <= ARM_SIZE && Math.abs(dy) <= ARM_SIZE) return 'center';
  if (dx >= -ARM_OFFSET - ARM_SIZE && dx <= -ARM_OFFSET + ARM_SIZE && Math.abs(dy) <= ARM_SIZE) return 'left';
  if (dx >= ARM_OFFSET - ARM_SIZE && dx <= ARM_OFFSET + ARM_SIZE && Math.abs(dy) <= ARM_SIZE) return 'right';
  if (dy >= -ARM_OFFSET - ARM_SIZE && dy <= -ARM_OFFSET + ARM_SIZE && Math.abs(dx) <= ARM_SIZE) return 'top';
  if (dy >= ARM_OFFSET - ARM_SIZE && dy <= ARM_OFFSET + ARM_SIZE && Math.abs(dx) <= ARM_SIZE) return 'bottom';
  return null;
}

// Hit-test the stack pane under a client point via the data-* attributes
// StackView renders. Shared by the cross-window dock receivers (popout and
// main); the local tab-drag flows keep their own inline versions — they need
// self-stack exclusion rules this helper doesn't know about.
export function hitTestStackAt(clientX: number, clientY: number): {
  groupId: string;
  path: number[];
  rect: DockTargetRect;
  zone: DockSide | null;
} | null {
  const els = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
  for (const node of els) {
    const cand = node.closest('[data-group-id][data-stack-path]') as HTMLElement | null;
    if (!cand) continue;
    const pathStr = cand.dataset.stackPath || '';
    const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
    const r = cand.getBoundingClientRect();
    const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    return { groupId: cand.dataset.groupId || '', path, rect, zone: detectDockZone(clientX, clientY, rect) };
  }
  return null;
}

export function dropPreviewRect(rect: DockTargetRect, zone: DockSide): DockTargetRect {
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  switch (zone) {
    case 'center': return rect;
    case 'left':   return { x: rect.x, y: rect.y, w: halfW, h: rect.h };
    case 'right':  return { x: rect.x + halfW, y: rect.y, w: halfW, h: rect.h };
    case 'top':    return { x: rect.x, y: rect.y, w: rect.w, h: halfH };
    case 'bottom': return { x: rect.x, y: rect.y + halfH, w: rect.w, h: halfH };
  }
}

// ── Viewport guide (screen-level drop zones) ────────────────────────────────
// Cross of 5 icons at the viewport center, shown while a floating window or a
// torn-off tab is dragged: left/right/top/bottom snap the group to a viewport
// half, the center maximizes it over the content area (right of the sidebar),
// and a sixth icon above the cross pops the group out as a separate OS window.

export type ViewportZone = 'left' | 'right' | 'top' | 'bottom' | 'max' | 'popout';

// Distance from the cross center to the pop-out icon's center. One extra arm
// step plus a gap so it reads as a separate action, not a fifth split target.
const POPOUT_OFFSET = ARM_OFFSET * 2 + 12;

export function detectViewportZone(
  mouseX: number,
  mouseY: number,
  vpW: number,
  vpH: number,
): ViewportZone | null {
  const dx = mouseX - vpW / 2;
  const dy = mouseY - vpH / 2;
  if (Math.abs(dx) <= ARM_SIZE && Math.abs(dy) <= ARM_SIZE) return 'max';
  if (dx >= -ARM_OFFSET - ARM_SIZE && dx <= -ARM_OFFSET + ARM_SIZE && Math.abs(dy) <= ARM_SIZE) return 'left';
  if (dx >= ARM_OFFSET - ARM_SIZE && dx <= ARM_OFFSET + ARM_SIZE && Math.abs(dy) <= ARM_SIZE) return 'right';
  if (dy >= -ARM_OFFSET - ARM_SIZE && dy <= -ARM_OFFSET + ARM_SIZE && Math.abs(dx) <= ARM_SIZE) return 'top';
  if (dy >= ARM_OFFSET - ARM_SIZE && dy <= ARM_OFFSET + ARM_SIZE && Math.abs(dx) <= ARM_SIZE) return 'bottom';
  if (dy >= -POPOUT_OFFSET - ARM_SIZE && dy <= -POPOUT_OFFSET + ARM_SIZE && Math.abs(dx) <= ARM_SIZE) return 'popout';
  return null;
}

// Geometry of a group docked to a content-area edge, given its primary size
// (width for left/right, height for top/bottom). Used both for the initial
// guide drop (size = half the content area) and to re-glue docked groups to
// their edge when the viewport or sidebar width changes.
export function dockEdgeGeom(
  edge: 'left' | 'right' | 'top' | 'bottom',
  size: number,
  vpW: number,
  vpH: number,
  contentLeft: number,
): DockTargetRect {
  switch (edge) {
    case 'left':   return { x: contentLeft, y: 0, w: size, h: vpH };
    case 'right':  return { x: vpW - size, y: 0, w: size, h: vpH };
    case 'top':    return { x: contentLeft, y: 0, w: vpW - contentLeft, h: size };
    case 'bottom': return { x: contentLeft, y: vpH - size, w: vpW - contentLeft, h: size };
  }
}

// All zones are content-area based (right of the sidebar): edge zones dock
// the group to half the content area (the app content reflows around it),
// 'max' fills the content area entirely.
export function viewportZoneToGeom(
  zone: Exclude<ViewportZone, 'popout'>,
  vpW: number,
  vpH: number,
  contentLeft: number,
): DockTargetRect {
  if (zone === 'max') return { x: contentLeft, y: 0, w: vpW - contentLeft, h: vpH };
  const size = zone === 'left' || zone === 'right'
    ? Math.round((vpW - contentLeft) / 2)
    : Math.round(vpH / 2);
  return dockEdgeGeom(zone, size, vpW, vpH, contentLeft);
}

// The app content area's left edge = the sidebar's right edge. Anchored on
// the Layout <aside> (not <main>) because the dock insets shift <main>'s box,
// which would feed back into this measurement. Clamped to 0 for the mobile
// off-screen sidebar.
export function contentAreaLeft(): number {
  const aside = document.querySelector('[data-app-sidebar]');
  return Math.max(0, aside ? aside.getBoundingClientRect().right : 0);
}

export function ViewportGuide({ activeZone }: { activeZone: ViewportZone | null }) {
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const cx = vpW / 2;
  const cy = vpH / 2;
  const preview = activeZone && activeZone !== 'popout'
    ? viewportZoneToGeom(activeZone, vpW, vpH, contentAreaLeft())
    : null;
  return createPortal(
    <>
      {preview && (
        <div
          style={{
            position: 'fixed',
            left: preview.x, top: preview.y,
            width: preview.w, height: preview.h,
            background: `${CMD.info}33`,
            border: `2px dashed ${CMD.info}`,
            borderRadius: 8,
            pointerEvents: 'none',
            zIndex: 2400,
            transition: 'left 80ms ease-out, top 80ms ease-out, width 80ms ease-out, height 80ms ease-out',
            boxSizing: 'border-box',
          }}
        />
      )}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2500 }}>
        <ZoneIcon offsetX={cx - ARM_SIZE} offsetY={cy - ARM_SIZE} active={activeZone === 'max'} kind="center" />
        <ZoneIcon offsetX={cx - ARM_OFFSET - ARM_SIZE} offsetY={cy - ARM_SIZE} active={activeZone === 'left'} kind="left" />
        <ZoneIcon offsetX={cx + ARM_OFFSET - ARM_SIZE} offsetY={cy - ARM_SIZE} active={activeZone === 'right'} kind="right" />
        <ZoneIcon offsetX={cx - ARM_SIZE} offsetY={cy - ARM_OFFSET - ARM_SIZE} active={activeZone === 'top'} kind="top" />
        <ZoneIcon offsetX={cx - ARM_SIZE} offsetY={cy + ARM_OFFSET - ARM_SIZE} active={activeZone === 'bottom'} kind="bottom" />
        <ZoneIcon offsetX={cx - ARM_SIZE} offsetY={cy - POPOUT_OFFSET - ARM_SIZE} active={activeZone === 'popout'} kind="popout" />
      </div>
    </>,
    document.body,
  );
}

export default function DockOverlay({ targetRect, activeZone }: DockOverlayProps) {
  const cx = targetRect.x + targetRect.w / 2;
  const cy = targetRect.y + targetRect.h / 2;

  const preview = activeZone ? dropPreviewRect(targetRect, activeZone) : null;

  return createPortal(
    <>
      {preview && (
        <div
          style={{
            position: 'fixed',
            left: preview.x, top: preview.y,
            width: preview.w, height: preview.h,
            background: `${CMD.info}33`,
            border: `2px dashed ${CMD.info}`,
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 2400,
            boxSizing: 'border-box',
          }}
        />
      )}
      {/* Diamond (5 zone icons). Half-extent = ARM_OFFSET + ARM_SIZE so the
          arm icons sit fully inside the wrapper. */}
      {(() => {
        const HALF = ARM_OFFSET + ARM_SIZE;
        return (
          <div
            style={{
              position: 'fixed',
              left: cx - HALF, top: cy - HALF,
              width: HALF * 2, height: HALF * 2,
              pointerEvents: 'none',
              zIndex: 2500,
            }}
          >
            <ZoneIcon offsetX={HALF - ARM_SIZE} offsetY={HALF - ARM_SIZE} active={activeZone === 'center'} kind="center" />
            <ZoneIcon offsetX={HALF - ARM_OFFSET - ARM_SIZE} offsetY={HALF - ARM_SIZE} active={activeZone === 'left'} kind="left" />
            <ZoneIcon offsetX={HALF + ARM_OFFSET - ARM_SIZE} offsetY={HALF - ARM_SIZE} active={activeZone === 'right'} kind="right" />
            <ZoneIcon offsetX={HALF - ARM_SIZE} offsetY={HALF - ARM_OFFSET - ARM_SIZE} active={activeZone === 'top'} kind="top" />
            <ZoneIcon offsetX={HALF - ARM_SIZE} offsetY={HALF + ARM_OFFSET - ARM_SIZE} active={activeZone === 'bottom'} kind="bottom" />
          </div>
        );
      })()}
    </>,
    document.body,
  );
}

interface ZoneIconProps {
  offsetX: number;
  offsetY: number;
  active: boolean;
  kind: DockSide | 'popout';
}

function ZoneIcon({ offsetX, offsetY, active, kind }: ZoneIconProps) {
  const size = ARM_SIZE * 2;
  const fill = active ? CMD.info : '#3a3a3a';
  const border = active ? CMD.bright : CMD.separator;
  return (
    <div
      style={{
        position: 'absolute',
        left: offsetX, top: offsetY,
        width: size, height: size,
        background: '#1a1a1a',
        border: `1px solid ${border}`,
        borderRadius: 4,
        boxShadow: active ? `0 0 8px ${CMD.info}` : '0 1px 3px rgba(0,0,0,0.4)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <ZoneShape kind={kind} fill={fill} />
    </div>
  );
}

function ZoneShape({ kind, fill }: { kind: DockSide | 'popout'; fill: string }) {
  const baseStyle: React.CSSProperties = { position: 'absolute', background: fill };
  switch (kind) {
    case 'center':
      return <div style={{ ...baseStyle, inset: 4 }} />;
    case 'popout':
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ExternalLink size={24} color={fill} />
        </div>
      );
    case 'left':
      return (
        <>
          <div style={{ ...baseStyle, left: 4, top: 4, bottom: 4, width: 'calc(50% - 4px)' }} />
          <div style={{ position: 'absolute', right: 4, top: 4, bottom: 4, width: 'calc(50% - 4px)', border: `1px dashed ${fill}`, boxSizing: 'border-box' }} />
        </>
      );
    case 'right':
      return (
        <>
          <div style={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: 'calc(50% - 4px)', border: `1px dashed ${fill}`, boxSizing: 'border-box' }} />
          <div style={{ ...baseStyle, right: 4, top: 4, bottom: 4, width: 'calc(50% - 4px)' }} />
        </>
      );
    case 'top':
      return (
        <>
          <div style={{ ...baseStyle, top: 4, left: 4, right: 4, height: 'calc(50% - 4px)' }} />
          <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, height: 'calc(50% - 4px)', border: `1px dashed ${fill}`, boxSizing: 'border-box' }} />
        </>
      );
    case 'bottom':
      return (
        <>
          <div style={{ position: 'absolute', top: 4, left: 4, right: 4, height: 'calc(50% - 4px)', border: `1px dashed ${fill}`, boxSizing: 'border-box' }} />
          <div style={{ ...baseStyle, bottom: 4, left: 4, right: 4, height: 'calc(50% - 4px)' }} />
        </>
      );
  }
}
