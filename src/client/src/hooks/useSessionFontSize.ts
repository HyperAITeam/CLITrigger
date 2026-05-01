import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../components/terminal-theme';

// Per-session terminal font size with localStorage persistence. Multiple
// components (the terminal renderer + the titlebar A-/A+ buttons) need to
// share the same value for one session, so we keep a module-level cache and
// notify subscribers via a per-sessionId listener set rather than going
// through React context (which would force a SessionWindow-wide re-render).

const cache = new Map<string, number>();
const listeners = new Map<string, Set<(size: number) => void>>();

function lsKey(sessionId: string): string {
  return `sessionFontSize:${sessionId}`;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));
}

function load(sessionId: string): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  let v = DEFAULT_FONT_SIZE;
  try {
    const raw = localStorage.getItem(lsKey(sessionId));
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed)) v = clamp(parsed);
    }
  } catch { /* localStorage unavailable */ }
  cache.set(sessionId, v);
  return v;
}

function write(sessionId: string, size: number): void {
  const next = clamp(size);
  if (cache.get(sessionId) === next) return;
  cache.set(sessionId, next);
  try { localStorage.setItem(lsKey(sessionId), String(next)); } catch { /* ignore */ }
  const subs = listeners.get(sessionId);
  if (subs) subs.forEach((fn) => fn(next));
}

export function getSessionFontSize(sessionId: string): number {
  return load(sessionId);
}

export function setSessionFontSize(sessionId: string, size: number): void {
  write(sessionId, size);
}

export function bumpSessionFontSize(sessionId: string, delta: number): void {
  write(sessionId, load(sessionId) + delta);
}

export function useSessionFontSize(sessionId: string): [number, (size: number) => void, (delta: number) => void] {
  const [size, setSize] = useState<number>(() => load(sessionId));

  useEffect(() => {
    setSize(load(sessionId));
    let set = listeners.get(sessionId);
    if (!set) { set = new Set(); listeners.set(sessionId, set); }
    set.add(setSize);
    return () => {
      const s = listeners.get(sessionId);
      if (s) {
        s.delete(setSize);
        if (s.size === 0) listeners.delete(sessionId);
      }
    };
  }, [sessionId]);

  const update = useCallback((next: number) => write(sessionId, next), [sessionId]);
  const bump = useCallback((delta: number) => write(sessionId, load(sessionId) + delta), [sessionId]);

  return [size, update, bump];
}
