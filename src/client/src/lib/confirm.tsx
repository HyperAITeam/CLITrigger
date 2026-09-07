import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { translateStatic } from '../i18n';

/**
 * In-app replacement for `window.confirm()`. Resolves true on 확인, false on
 * 취소 / Esc / backdrop click. Mounts its own React root so it works from any
 * handler (including popout windows) without a provider.
 */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      // Defer: React warns on unmounting a root from inside its own event handler.
      setTimeout(() => {
        root.unmount();
        host.remove();
        prevFocus?.focus?.();
      }, 0);
    };
    root.render(<ConfirmDialog message={message} onDone={done} />);
  });
}

function ConfirmDialog({ message, onDone }: { message: string; onDone: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onDone(false); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-modal flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onDone(false); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm bg-theme-card rounded-2xl shadow-elevated p-5 animate-scale-in"
        onKeyDown={(e) => {
          // ponytail: two-button focus trap, good enough for a confirm
          if (e.key !== 'Tab') return;
          e.preventDefault();
          (document.activeElement === okRef.current ? cancelRef : okRef).current?.focus();
        }}
      >
        <p className="text-sm text-theme-text whitespace-pre-line leading-relaxed">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn-ghost btn-sm" onClick={() => onDone(false)}>
            {translateStatic('confirm.cancel')}
          </button>
          <button ref={okRef} type="button" className="btn-primary btn-sm" onClick={() => onDone(true)}>
            {translateStatic('confirm.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
