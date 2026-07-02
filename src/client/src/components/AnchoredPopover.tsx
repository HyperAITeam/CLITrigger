import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Small anchored dropdown: renders below an anchor element via portal +
// position:fixed so it escapes overflow/transform clipping (e.g. scrolling
// planner cards), clamped horizontally to the viewport. Closes on
// outside-click / scroll / resize.
// ponytail: no vertical flip — relies on the child's own max-height to scroll
// near the bottom; add flip only if a dropdown actually opens off-screen.
export function AnchoredPopover({
  anchorRef, width, onClose, className, style, children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  width: number;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    if (left < 8) left = 8;
    setPos({ top: r.bottom + 4, left });
  }, [anchorRef, width]);

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
    <div ref={ref} className={className} style={{ position: 'fixed', top: pos.top, left: pos.left, width, ...style }}>
      {children}
    </div>,
    document.body,
  );
}
