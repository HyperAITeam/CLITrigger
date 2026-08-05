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
 * → wait for the window `focus` event (the OS cycle actually landing back in
 * this renderer) → two RAFs → focusTarget(). Returns false (and does nothing)
 * outside Electron or while another handoff is running. Callers must ensure
 * no IME composition is in flight.
 *
 * The guard MUST hold until window focus has returned, not just until a
 * double-RAF: the OS cycle's artifacts — the page blur and the focus event
 * Chromium re-fires on the focused element when the window reactivates —
 * arrive asynchronously, and a focusin observed while document.hasFocus() is
 * false is exactly the App-level rescue's trigger condition. v0.2.46 released
 * on RAF2, which can beat the OS round-trip; the refire then landed after
 * release, the rescue started another window cycle, and each cycle's refire
 * re-armed the next — a runaway blur→focus flicker storm that froze the
 * desktop. Everything the cycle emits must land while inFlight still holds.
 */
export function forceImeHandoff(focusTarget: () => void): boolean {
  const api = (window as unknown as {
    electronAPI?: { imeReset?: (force?: boolean) => void };
  }).electronAPI;
  if (!api?.imeReset || inFlight) return false;
  inFlight = true;
  let released = false;
  const release = () => {
    released = true;
    inFlight = false;
    window.clearTimeout(watchdog);
    window.removeEventListener('focus', onWindowFocus);
  };
  const finish = () => {
    if (released) return;
    try { focusTarget(); } finally { release(); }
  };
  // Watchdog: if the focus event never arrives (window never actually lost
  // focus, hidden page starving RAFs), a stuck handoff must not permanently
  // disable every future rescue — best-effort focus and release.
  const watchdog = window.setTimeout(finish, 1000);
  const onWindowFocus = () => {
    // Two RAFs after focus return: the activation-driven focus refire on the
    // focused element dispatches within the reactivation task — it must be
    // swallowed while the guard still holds, and xterm's own focus
    // restoration needs the same settling time as before.
    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
  };
  window.addEventListener('focus', onWindowFocus);
  (document.activeElement as HTMLElement | null)?.blur?.();
  api.imeReset(true);
  return true;
}
