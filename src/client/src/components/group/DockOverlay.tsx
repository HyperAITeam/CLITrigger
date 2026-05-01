// 5-zone diamond dock indicator (Visual Studio-style). Rendered via portal at
// document.body so it overlays everything including the dragged window.
//
// The host computes which zone the mouse is over (via `detectDockZone`) and
// passes it in. This component is purely visual: the diamond + drop preview
// rectangle inside the target stack's content area.

import { createPortal } from 'react-dom';
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

const ARM_SIZE = 30;     // half-side of each zone icon
const ARM_OFFSET = 36;   // distance from diamond center to side icons

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
      {/* Diamond (5 zone icons) */}
      <div
        style={{
          position: 'fixed',
          left: cx - 60, top: cy - 60,
          width: 120, height: 120,
          pointerEvents: 'none',
          zIndex: 2500,
        }}
      >
        <ZoneIcon offsetX={60 - ARM_SIZE} offsetY={60 - ARM_SIZE} active={activeZone === 'center'} kind="center" />
        <ZoneIcon offsetX={60 - ARM_OFFSET - ARM_SIZE} offsetY={60 - ARM_SIZE} active={activeZone === 'left'} kind="left" />
        <ZoneIcon offsetX={60 + ARM_OFFSET - ARM_SIZE} offsetY={60 - ARM_SIZE} active={activeZone === 'right'} kind="right" />
        <ZoneIcon offsetX={60 - ARM_SIZE} offsetY={60 - ARM_OFFSET - ARM_SIZE} active={activeZone === 'top'} kind="top" />
        <ZoneIcon offsetX={60 - ARM_SIZE} offsetY={60 + ARM_OFFSET - ARM_SIZE} active={activeZone === 'bottom'} kind="bottom" />
      </div>
    </>,
    document.body,
  );
}

interface ZoneIconProps {
  offsetX: number;
  offsetY: number;
  active: boolean;
  kind: DockSide;
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

function ZoneShape({ kind, fill }: { kind: DockSide; fill: string }) {
  const baseStyle: React.CSSProperties = { position: 'absolute', background: fill };
  switch (kind) {
    case 'center':
      return <div style={{ ...baseStyle, inset: 4 }} />;
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
