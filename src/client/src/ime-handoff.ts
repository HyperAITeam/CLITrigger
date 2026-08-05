// Forced native focus handoff for Windows IME (TSF) recovery — the single
// shared implementation so concurrent rescuers can't fight each other.
//
// Why one module: three rescuers exist (App-level dead-focus bridge,
// SessionForm mount handoff, SessionTerminal stranded-TSF self-heal). Each
// forced handoff makes document.hasFocus() read false mid-cycle by design,
// which is exactly the trigger condition of the App-level rescue — without a
// shared in-flight guard the rescuers re-trigger off each other's cycles and
// blur the very input they are trying to focus (feedback loop).
//
// Why the main process cycles the whole window: ime-debug 2026-07-23 shows
// five consecutive webview-level rescues failing back-to-back, then instant
// recovery from a real OS blur→focus (alt-tab). blurWebView()-based forcing
// shipped 2026-08-03 and form entry was still dead on 2026-08-05, so the
// webview-level cycle demonstrably does not rebind a stranded TSF context.
// main's ime:reset(force) handler now blurs and refocuses the BrowserWindow
// itself, routing through the focus-bridge exactly like the proven alt-tab.

let inFlight = false;

export function imeHandoffInFlight(): boolean {
  return inFlight;
}

/**
 * Blur the current element → ime:reset(force) (OS window blur→focus in main)
 * → two RAFs → focusTarget(). Returns false (and does nothing) outside
 * Electron or while another handoff is running. Callers must ensure no IME
 * composition is in flight. focusTarget runs before the in-flight guard
 * releases, so the focusin it fires synchronously cannot re-trigger a rescue.
 */
export function forceImeHandoff(focusTarget: () => void): boolean {
  const api = (window as unknown as {
    electronAPI?: { imeReset?: (force?: boolean) => void };
  }).electronAPI;
  if (!api?.imeReset || inFlight) return false;
  inFlight = true;
  // Idempotent release: normally after focusTarget on RAF2, but a hidden or
  // occluded page can starve RAFs — the timer keeps a stuck handoff from
  // permanently disabling every future rescue.
  let released = false;
  const release = () => { released = true; inFlight = false; };
  const timer = window.setTimeout(release, 1000);
  (document.activeElement as HTMLElement | null)?.blur?.();
  api.imeReset(true);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.clearTimeout(timer);
      try { focusTarget(); } finally { if (!released) release(); }
    });
  });
  return true;
}
