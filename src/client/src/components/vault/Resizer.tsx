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
        const onMove = (ev: PointerEvent) => onResize(ev.clientX);
        const onUp = () => {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          el.removeEventListener('pointercancel', onUp);
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
      }}
      className="w-1.5 shrink-0 cursor-col-resize bg-warm-300 hover:bg-accent active:bg-accent transition-colors"
    />
  );
}
