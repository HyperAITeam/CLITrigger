import { useCallback, useEffect, useState } from 'react';

export type LeftPanelId = 'files' | 'search' | 'tags';
// 'preview' is a transient, edit-mode-only tab — intentionally excluded from
// RIGHT_PANEL_IDS below so it's never persisted/restored from localStorage.
export type RightPanelId = 'graph' | 'outline' | 'backlinks' | 'outgoing' | 'preview';

const LEFT_PANEL_IDS: readonly LeftPanelId[] = ['files', 'search', 'tags'];
const RIGHT_PANEL_IDS: readonly RightPanelId[] = ['graph', 'outline', 'backlinks', 'outgoing'];

interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

interface PanelsState {
  leftPanelId: LeftPanelId;
  rightPanelId: RightPanelId;
}

const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 260,
  rightWidth: 280,
  leftCollapsed: false,
  rightCollapsed: false,
};

const DEFAULT_PANELS: PanelsState = {
  leftPanelId: 'files',
  rightPanelId: 'graph',
};

const SIDEBAR_W_MIN = 32;
const SIDEBAR_W_MAX = 100000;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function readLayout(key: string): LayoutState {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      leftWidth: clamp(Number(parsed.leftWidth) || DEFAULT_LAYOUT.leftWidth, SIDEBAR_W_MIN, SIDEBAR_W_MAX),
      rightWidth: clamp(Number(parsed.rightWidth) || DEFAULT_LAYOUT.rightWidth, SIDEBAR_W_MIN, SIDEBAR_W_MAX),
      leftCollapsed: Boolean(parsed.leftCollapsed),
      rightCollapsed: Boolean(parsed.rightCollapsed),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function readPanels(key: string): PanelsState {
  if (typeof window === 'undefined') return DEFAULT_PANELS;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_PANELS;
    const parsed = JSON.parse(raw) as Partial<PanelsState>;
    return {
      leftPanelId: LEFT_PANEL_IDS.includes(parsed.leftPanelId as LeftPanelId)
        ? (parsed.leftPanelId as LeftPanelId)
        : DEFAULT_PANELS.leftPanelId,
      rightPanelId: RIGHT_PANEL_IDS.includes(parsed.rightPanelId as RightPanelId)
        ? (parsed.rightPanelId as RightPanelId)
        : DEFAULT_PANELS.rightPanelId,
    };
  } catch {
    return DEFAULT_PANELS;
  }
}

function readActiveFile(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface VaultState {
  layout: LayoutState;
  panels: PanelsState;
  activeFile: string | null;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  toggleLeftCollapsed: () => void;
  toggleRightCollapsed: () => void;
  setLeftPanelId: (id: LeftPanelId) => void;
  setRightPanelId: (id: RightPanelId) => void;
  setActiveFile: (path: string | null) => void;
}

export function useVaultState(projectId: string): VaultState {
  const layoutKey = `vault:layout:${projectId}`;
  const panelsKey = `vault:panels:${projectId}`;
  const activeKey = `vault:active:${projectId}`;

  const [layout, setLayoutState] = useState<LayoutState>(() => readLayout(layoutKey));
  const [panels, setPanelsState] = useState<PanelsState>(() => readPanels(panelsKey));
  const [activeFile, setActiveFileState] = useState<string | null>(() => readActiveFile(activeKey));

  useEffect(() => {
    try { localStorage.setItem(layoutKey, JSON.stringify(layout)); } catch { /* ignore */ }
  }, [layout, layoutKey]);

  useEffect(() => {
    try { localStorage.setItem(panelsKey, JSON.stringify(panels)); } catch { /* ignore */ }
  }, [panels, panelsKey]);

  useEffect(() => {
    try {
      if (activeFile) localStorage.setItem(activeKey, activeFile);
      else localStorage.removeItem(activeKey);
    } catch { /* ignore */ }
  }, [activeFile, activeKey]);

  const setLeftWidth = useCallback((w: number) => {
    setLayoutState((l) => ({ ...l, leftWidth: clamp(w, SIDEBAR_W_MIN, SIDEBAR_W_MAX) }));
  }, []);
  const setRightWidth = useCallback((w: number) => {
    setLayoutState((l) => ({ ...l, rightWidth: clamp(w, SIDEBAR_W_MIN, SIDEBAR_W_MAX) }));
  }, []);
  const toggleLeftCollapsed = useCallback(() => {
    setLayoutState((l) => ({ ...l, leftCollapsed: !l.leftCollapsed }));
  }, []);
  const toggleRightCollapsed = useCallback(() => {
    setLayoutState((l) => ({ ...l, rightCollapsed: !l.rightCollapsed }));
  }, []);
  const setLeftPanelId = useCallback((id: LeftPanelId) => {
    setPanelsState((p) => ({ ...p, leftPanelId: id }));
  }, []);
  const setRightPanelId = useCallback((id: RightPanelId) => {
    setPanelsState((p) => ({ ...p, rightPanelId: id }));
  }, []);
  const setActiveFile = useCallback((path: string | null) => {
    setActiveFileState(path);
  }, []);

  return {
    layout, panels, activeFile,
    setLeftWidth, setRightWidth,
    toggleLeftCollapsed, toggleRightCollapsed,
    setLeftPanelId, setRightPanelId,
    setActiveFile,
  };
}
