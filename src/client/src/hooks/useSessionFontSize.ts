import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../components/terminal-theme';

// Per-session terminal font size with localStorage persistence. Multiple
// components (the terminal renderer + the titlebar A-/A+ buttons) need to
// share the same value for one session, so we keep a module-level cache and
// notify subscribers via a per-sessionId listener set rather than going
// through React context (which would force a SessionWindow-wide re-render).
//
// Sessions whose fontSize was never explicitly set (no localStorage key)
// fall back to a runtime-mutable globalDefault. Settings → Sessions can
// change this default at any time; we broadcast the new value to active
// subscribers whose sessions still inherit the default (no localStorage key
// yet, no module cache hit) so unmodified panes resize live without reload.

const cache = new Map<string, number>();
const listeners = new Map<string, Set<(size: number) => void>>();
let globalDefault = DEFAULT_FONT_SIZE;

function lsKey(sessionId: string): string {
  return `sessionFontSize:${sessionId}`;
}

// Cross-window sync: same stale-cache issue as useSessionTheme — a font size
// changed in a popout window never reaches this window's module cache.
window.addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage || !e.key?.startsWith('sessionFontSize:')) return;
  const sessionId = e.key.slice('sessionFontSize:'.length);
  cache.delete(sessionId);
  const subs = listeners.get(sessionId);
  if (subs) {
    const next = load(sessionId);
    subs.forEach((fn) => fn(next));
  }
});

function clamp(n: number): number {
  if (!Number.isFinite(n)) return globalDefault;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));
}

function hasExplicit(sessionId: string): boolean {
  if (cache.has(sessionId)) return true;
  try { return localStorage.getItem(lsKey(sessionId)) !== null; } catch { return false; }
}

function load(sessionId: string): number {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  let v: number | null = null;
  try {
    const raw = localStorage.getItem(lsKey(sessionId));
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed)) v = clamp(parsed);
    }
  } catch { /* localStorage unavailable */ }
  if (v === null) {
    // Inherit globalDefault — do NOT cache, so a later change to globalDefault
    // takes effect for sessions that never set their own value.
    return clamp(globalDefault);
  }
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

export function setGlobalDefaultFontSize(size: number): void {
  const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(size)));
  if (!Number.isFinite(next)) return;
  if (next === globalDefault) return;
  globalDefault = next;
  // Notify active subscribers whose sessions still inherit the default.
  // Sessions with an explicit localStorage value (or a module cache hit) keep
  // their own value untouched.
  listeners.forEach((subs, sid) => {
    if (hasExplicit(sid)) return;
    subs.forEach((fn) => fn(next));
  });
}

export function getGlobalDefaultFontSize(): number {
  return globalDefault;
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
