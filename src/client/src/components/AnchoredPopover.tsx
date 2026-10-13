import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Small anchored dropdown: renders below an anchor element via portal +
// position:fixed so it escapes overflow/transform clipping (e.g. scrolling
// planner cards), clamped horizontally to the viewport. Closes on
// outside-click / scroll / resize.
// ponytail: no automatic vertical flip — callers that sit near the bottom pass
// placement="top"; add auto-flip only if a dropdown actually opens off-screen.
export function AnchoredPopover({
  anchorRef, width, onClose, className, style, children, placement = 'bottom',
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  width: number;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  placement?: 'bottom' | 'top';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    if (left < 8) left = 8;
    // "top" anchors the popover's bottom edge above the anchor via CSS `bottom`,
    // so no measurement of the popover's own height is needed.
    setPos(placement === 'top'
      ? { bottom: window.innerHeight - r.top + 4, left }
      : { top: r.bottom + 4, left });
  }, [anchorRef, width, placement]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onScrollOrResize = () => onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [onClose, anchorRef]);

  if (!pos) return null;
  return createPortal(
    <div ref={ref} className={className} style={{ position: 'fixed', ...pos, width, ...style }}>
      {children}
    </div>,
    document.body,
  );
}
