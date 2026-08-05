import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The regression this guards against: v0.2.46 released the in-flight guard on
// a bare double-RAF, which can beat the OS blur→focus round-trip. The cycle's
// focus refire then landed after release, re-armed the App-level rescue, and
// each rescue's window cycle re-armed the next — a runaway blur→focus flicker
// storm that froze the desktop. The guard must hold until window focus
// actually returns.

async function loadModule() {
  vi.resetModules();
  return await import('./ime-handoff');
}

type TestWindow = Window & { electronAPI?: { imeReset: (force?: boolean) => void } };

describe('forceImeHandoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16) as unknown as number,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (window as TestWindow).electronAPI;
  });

  it('returns false outside Electron', async () => {
    const { forceImeHandoff } = await loadModule();
    expect(forceImeHandoff(() => {})).toBe(false);
  });

  it('holds the guard until window focus returns, swallowing mid-cycle re-triggers', async () => {
    const imeReset = vi.fn();
    (window as TestWindow).electronAPI = { imeReset };
    const { forceImeHandoff, imeHandoffInFlight } = await loadModule();
    const focusTarget = vi.fn();

    expect(forceImeHandoff(focusTarget)).toBe(true);
    expect(imeReset).toHaveBeenCalledTimes(1);

    // A rescue re-triggering off the cycle's own artifacts must be swallowed.
    expect(forceImeHandoff(focusTarget)).toBe(false);
    expect(imeReset).toHaveBeenCalledTimes(1);

    // Elapsed frames alone must NOT release the guard — only focus return may.
    vi.advanceTimersByTime(100);
    expect(imeHandoffInFlight()).toBe(true);
    expect(focusTarget).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(100); // two RAFs after focus return
    expect(focusTarget).toHaveBeenCalledTimes(1);
    expect(imeHandoffInFlight()).toBe(false);

    // Guard is released — the next genuine rescue goes through.
    expect(forceImeHandoff(focusTarget)).toBe(true);
  });

  it('watchdog releases a handoff whose focus event never arrives', async () => {
    (window as TestWindow).electronAPI = { imeReset: vi.fn() };
    const { forceImeHandoff, imeHandoffInFlight } = await loadModule();
    const focusTarget = vi.fn();

    forceImeHandoff(focusTarget);
    vi.advanceTimersByTime(1000);
    expect(focusTarget).toHaveBeenCalledTimes(1);
    expect(imeHandoffInFlight()).toBe(false);
  });
});
