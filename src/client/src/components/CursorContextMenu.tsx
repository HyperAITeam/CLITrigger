// Right-click context menu anchored at the cursor position. Shares the
// portal/clamping/dismissal behavior of the existing dropdown menus
// (TodoItem's MoreMenu, FileExplorerPanel's ContextMenu): rendered into
// document.body with position:fixed, flipped/shifted to stay ≥8px inside the
// viewport, closed on outside mousedown / Escape / scroll / resize. Any click
// inside the menu also closes it (items run their own onClick first).
//
// Children are the menu items — use `ctxMenuItemClass` /
// `ctxMenuDangerItemClass` for buttons and `<CtxMenuSeparator />` between
// groups so menus look identical across call sites.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const ctxMenuItemClass =
  'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-warm-600 hover:bg-theme-hover rounded-md transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed';
export const ctxMenuDangerItemClass =
  'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-status-error hover:bg-status-error/10 rounded-md transition-colors text-left disabled:opacity-30 disabled:cursor-not-allowed';

export function CtxMenuSeparator() {
  return <div className="my-1 border-t border-warm-200" />;
}

// True when a right-click should keep the browser's native context menu:
// text fields (copy/paste) and xterm terminals handle their own.
export function isNativeContextMenuTarget(e: React.MouseEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], .xterm');
}

export default function CursorContextMenu({ x, y, onClose, children }: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + el.offsetWidth > vw - 8) left = Math.max(8, vw - 8 - el.offsetWidth);
    if (top + el.offsetHeight > vh - 8) top = Math.max(8, vh - 8 - el.offsetHeight);
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    setPos({ top, left, visible: true });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-tooltip min-w-[180px] rounded-xl py-1 shadow-elevated"
      style={{
        top: pos.top,
        left: pos.left,
        opacity: pos.visible ? 1 : 0,
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
      }}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}
