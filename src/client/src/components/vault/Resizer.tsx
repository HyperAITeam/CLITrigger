interface Props {
  onResize: (clientX: number) => void;
}

export function Resizer({ onResize }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        e.preventDefault();
        // Pointer capture routes all move/up events to this handle even when the
        // cursor passes over an iframe or editor that would otherwise swallow
        // them — without it the drag sticks (missed mouseup) and stops widening
        // (missed mousemove) at the editor boundary.
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        let frameId: number | null = null;
        let pendingClientX: number | null = null;
        const flush = () => {
          frameId = null;
          if (pendingClientX === null) return;
          const clientX = pendingClientX;
          pendingClientX = null;
          onResize(clientX);
        };
        const onMove = (ev: PointerEvent) => {
          pendingClientX = ev.clientX;
          if (frameId === null) frameId = requestAnimationFrame(flush);
        };
        const onEnd = (ev: PointerEvent) => {
          if (frameId !== null) cancelAnimationFrame(frameId);
          frameId = null;
          if (ev.type === 'pointerup' && pendingClientX !== null) flush();
          pendingClientX = null;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onEnd);
          el.removeEventListener('pointercancel', onEnd);
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onEnd);
        el.addEventListener('pointercancel', onEnd);
      }}
      className="w-1.5 shrink-0 cursor-col-resize bg-warm-300 hover:bg-accent active:bg-accent transition-colors"
    />
  );
}
