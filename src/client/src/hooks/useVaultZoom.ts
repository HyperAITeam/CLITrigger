import { useCallback, useEffect, useState } from 'react';

// Per-project Vault font size with localStorage persistence. Mirrors
// useSessionFontSize: module-level cache + per-key listener Set so multiple
// consumers (editor + preview) share one value for a given projectId without
// going through React context. Projects with no explicit value fall back to
// a runtime-mutable globalDefault.

export const DEFAULT_VAULT_FONT_SIZE = 13;
export const MIN_VAULT_FONT_SIZE = 8;
export const MAX_VAULT_FONT_SIZE = 28;

const cache = new Map<string, number>();
const listeners = new Map<string, Set<(size: number) => void>>();
let globalDefault = DEFAULT_VAULT_FONT_SIZE;

function lsKey(projectId: string): string {
  return `vault:zoom:${projectId}`;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return globalDefault;
  return Math.max(MIN_VAULT_FONT_SIZE, Math.min(MAX_VAULT_FONT_SIZE, Math.round(n)));
}

function load(projectId: string): number {
  const cached = cache.get(projectId);
  if (cached !== undefined) return cached;
  let v: number | null = null;
  try {
    const raw = localStorage.getItem(lsKey(projectId));
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed)) v = clamp(parsed);
    }
  } catch { /* localStorage unavailable */ }
  if (v === null) return clamp(globalDefault);
  cache.set(projectId, v);
  return v;
}

function write(projectId: string, size: number): void {
  const next = clamp(size);
  if (cache.get(projectId) === next) return;
  cache.set(projectId, next);
  try { localStorage.setItem(lsKey(projectId), String(next)); } catch { /* ignore */ }
  const subs = listeners.get(projectId);
  if (subs) subs.forEach((fn) => fn(next));
}

export function getVaultZoom(projectId: string): number {
  return load(projectId);
}

export function setVaultZoom(projectId: string, size: number): void {
  write(projectId, size);
}

export function bumpVaultZoom(projectId: string, delta: number): void {
  write(projectId, load(projectId) + delta);
}

export function useVaultZoom(projectId: string): [number, (size: number) => void, (delta: number) => void] {
  const [size, setSize] = useState<number>(() => load(projectId));

  useEffect(() => {
    setSize(load(projectId));
    let set = listeners.get(projectId);
    if (!set) { set = new Set(); listeners.set(projectId, set); }
    set.add(setSize);
    return () => {
      const s = listeners.get(projectId);
      if (s) {
        s.delete(setSize);
        if (s.size === 0) listeners.delete(projectId);
      }
    };
  }, [projectId]);

  const update = useCallback((next: number) => write(projectId, next), [projectId]);
  const bump = useCallback((delta: number) => write(projectId, load(projectId) + delta), [projectId]);

  return [size, update, bump];
}
