import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ITheme } from '@xterm/xterm';
import {
  DEFAULT_PRESET_ID,
  TERMINAL_PRESETS,
  getPreset,
  type TerminalPresetId,
} from '../lib/terminal-presets';

// Per-session terminal theme with localStorage persistence. Same module-level
// cache + listener-set pattern as useSessionFontSize so the picker UI and the
// SessionTerminal both stay in sync without going through React context.
//
// State shape:
//   { presetId: 'default' | 'claude' | … | 'custom',
//     custom?: { background?, foreground?, cursor?, selectionBackground?, accent? } }
//
// `custom` is a 9th slot — when active, the 5 listed fields override the
// `default` preset (accent maps to brightBlue + cursor when set). All 16 ANSI
// colors stay inherited from default to keep the editor surface small.

export type SessionThemeId = TerminalPresetId | 'custom';

export interface CustomThemeColors {
  background?: string;
  foreground?: string;
  cursor?: string;
  selectionBackground?: string;
  accent?: string;
}

export interface SessionThemeState {
  presetId: SessionThemeId;
  custom?: CustomThemeColors;
}

const DEFAULT_STATE: SessionThemeState = { presetId: DEFAULT_PRESET_ID };

const cache = new Map<string, SessionThemeState>();
const listeners = new Map<string, Set<(state: SessionThemeState) => void>>();

function lsKey(sessionId: string): string {
  return `sessionTheme:${sessionId}`;
}

function isValidPresetId(id: unknown): id is SessionThemeId {
  if (typeof id !== 'string') return false;
  return id === 'custom' || id in TERMINAL_PRESETS;
}

function load(sessionId: string): SessionThemeState {
  const cached = cache.get(sessionId);
  if (cached !== undefined) return cached;
  let state: SessionThemeState = DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(lsKey(sessionId));
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<SessionThemeState>;
      if (parsed && isValidPresetId(parsed.presetId)) {
        state = {
          presetId: parsed.presetId,
          custom: parsed.custom && typeof parsed.custom === 'object' ? parsed.custom : undefined,
        };
      }
    }
  } catch { /* malformed JSON or LS unavailable — fall back to default */ }
  cache.set(sessionId, state);
  return state;
}

function write(sessionId: string, next: SessionThemeState): void {
  const prev = cache.get(sessionId);
  if (prev && prev.presetId === next.presetId && shallowEqualCustom(prev.custom, next.custom)) return;
  cache.set(sessionId, next);
  try { localStorage.setItem(lsKey(sessionId), JSON.stringify(next)); } catch { /* ignore */ }
  const subs = listeners.get(sessionId);
  if (subs) subs.forEach((fn) => fn(next));
}

function shallowEqualCustom(a?: CustomThemeColors, b?: CustomThemeColors): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.background === b.background &&
    a.foreground === b.foreground &&
    a.cursor === b.cursor &&
    a.selectionBackground === b.selectionBackground &&
    a.accent === b.accent
  );
}

export function getSessionTheme(sessionId: string): SessionThemeState {
  return load(sessionId);
}

export function setSessionTheme(sessionId: string, next: SessionThemeState): void {
  write(sessionId, next);
}

// Resolve a SessionThemeState into the final xterm.js ITheme object.
// For preset slots, returns the preset theme as-is. For 'custom', layers
// the user's overrides on top of the default preset (accent is mapped to
// both `cursor` (when not separately set) and `brightBlue` so signature
// color shows up in syntax highlighting too).
export function resolveTerminalTheme(state: SessionThemeState): ITheme {
  if (state.presetId !== 'custom') {
    return getPreset(state.presetId).theme;
  }
  const base = getPreset(DEFAULT_PRESET_ID).theme;
  const c = state.custom ?? {};
  const cursor = c.cursor ?? c.accent ?? base.cursor;
  return {
    ...base,
    background: c.background ?? base.background,
    foreground: c.foreground ?? base.foreground,
    cursor,
    cursorAccent: c.background ?? base.cursorAccent,
    selectionBackground: c.selectionBackground ?? base.selectionBackground,
    brightBlue: c.accent ?? base.brightBlue,
    blue: c.accent ?? base.blue,
  };
}

export function useSessionTheme(
  sessionId: string,
): [SessionThemeState, ITheme, (next: SessionThemeState) => void] {
  const [state, setState] = useState<SessionThemeState>(() => load(sessionId));

  useEffect(() => {
    setState(load(sessionId));
    let set = listeners.get(sessionId);
    if (!set) { set = new Set(); listeners.set(sessionId, set); }
    set.add(setState);
    return () => {
      const s = listeners.get(sessionId);
      if (s) {
        s.delete(setState);
        if (s.size === 0) listeners.delete(sessionId);
      }
    };
  }, [sessionId]);

  const update = useCallback((next: SessionThemeState) => write(sessionId, next), [sessionId]);
  const theme = useMemo(() => resolveTerminalTheme(state), [state]);

  return [state, theme, update];
}
