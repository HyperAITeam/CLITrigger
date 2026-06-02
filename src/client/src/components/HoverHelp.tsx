import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Hover/focus help box rendered via a portal with viewport clamping.
// Wraps any trigger element; shows `title` + optional `body` after a short
// delay. No-op (renders children only) when `body` is empty.
export default function HoverHelp({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children: React.ReactNode;
}) {
  const enabled = !!body && body.trim().length > 0;
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const openTimer = useRef<number | null>(null);

  const updatePos = useCallback(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pop = popRef.current;
    const pw = pop?.offsetWidth ?? 288;
    const ph = pop?.offsetHeight ?? 120;
    let top = r.bottom + 6;
    let left = r.left;
    if (left + pw > vw - 8) left = vw - 8 - pw;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) top = r.top - ph - 6;
    if (top < 8) top = 8;
    setPos({ top, left });
    setPositioned(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setPositioned(false);
      return;
    }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
  }, []);

  if (!enabled) return <>{children}</>;

  const scheduleOpen = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 250);
  };
  const cancelOpen = () => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setOpen(false);
  };

  return (
    <>
      <div
        ref={anchorRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={cancelOpen}
        onFocus={scheduleOpen}
        onBlur={cancelOpen}
      >
        {children}
      </div>
      {open && createPortal(
        <div
          ref={popRef}
          role="tooltip"
          className="fixed w-72 p-3 rounded-lg shadow-elevated text-xs leading-relaxed z-tooltip pointer-events-none"
          style={{
            top: pos.top,
            left: pos.left,
            opacity: positioned ? 1 : 0,
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            borderWidth: '1px',
            color: 'var(--color-text-primary)',
            transition: 'opacity 120ms ease-out',
          }}
        >
          <div className="font-semibold mb-1">{title}</div>
          <p style={{ color: 'var(--color-text-secondary)' }}>{body}</p>
        </div>,
        document.body,
      )}
    </>
  );
}
