import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown, ChevronRight, Loader2, AlertCircle, RefreshCw, EyeOff, Eye, Copy, ExternalLink, FolderOpen, Pin, PinOff,
} from 'lucide-react';
import { useI18n } from '../../../i18n';
import { listFiles, openFile } from '../../../api/files';
import type { FileEntry } from '../../../api/files';
import { addPathToVaultIgnore, removePathFromVaultIgnore } from '../../../api/vault';
import { iconFor } from '../files-utils';

interface TreeNodeState {
  expanded: boolean;
  loading: boolean;
  error?: string;
  children?: FileEntry[];
}

interface Props {
  projectId: string;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onVaultIgnoreChanged?: () => void;
}

function TreeRow({
  entry, depth, state, fullPath, selectedPath, onToggle, onSelect, onContextMenu,
}: {
  entry: FileEntry;
  depth: number;
  state?: TreeNodeState;
  fullPath: string;
  selectedPath: string | null;
  onToggle: (path: string, entry: FileEntry) => void;
  onSelect: (path: string, entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, fullPath: string, entry: FileEntry) => void;
}) {
  const isDir = entry.type === 'directory';
  const expanded = state?.expanded ?? false;
  const isSelected = selectedPath === fullPath;

  return (
    <button
      type="button"
      onClick={() => {
        if (isDir) onToggle(fullPath, entry);
        else onSelect(fullPath, entry);
      }}
      onDoubleClick={() => { if (isDir) onSelect(fullPath, entry); }}
      onContextMenu={(e) => onContextMenu(e, fullPath, entry)}
      className={`w-full flex items-center gap-1.5 py-0.5 px-1 text-xs text-left rounded transition-colors ${
        isSelected ? 'bg-accent/15 text-warm-800' : 'hover:bg-warm-100 text-warm-700'
      }`}
      style={{ paddingLeft: 4 + depth * 12 }}
      title={entry.name}
    >
      {isDir ? (
        expanded
          ? <ChevronDown className="w-3 h-3 shrink-0 text-warm-400" />
          : <ChevronRight className="w-3 h-3 shrink-0 text-warm-400" />
      ) : <span className="w-3 h-3 shrink-0" />}
      {iconFor(entry, expanded)}
      <span className={`truncate ${entry.hidden ? 'opacity-60 italic' : ''}`}>{entry.name}</span>
    </button>
  );
}

function TreeBranch({
  projectId, parentPath, entries, depth, nodeStates, setNodeStates, showHidden, selectedPath, onSelect, onContextMenu,
}: {
  projectId: string;
  parentPath: string;
  entries: FileEntry[];
  depth: number;
  nodeStates: Map<string, TreeNodeState>;
  setNodeStates: React.Dispatch<React.SetStateAction<Map<string, TreeNodeState>>>;
  showHidden: boolean;
  selectedPath: string | null;
  onSelect: (path: string, entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, fullPath: string, entry: FileEntry) => void;
}) {
  const toggle = useCallback(async (full: string, entry: FileEntry) => {
    const prev = nodeStates.get(full);
    if (prev?.expanded) {
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { ...prev, expanded: false });
        return n;
      });
      return;
    }
    if (prev?.children) {
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { ...prev, expanded: true });
        return n;
      });
      return;
    }
    setNodeStates((m) => {
      const n = new Map(m);
      n.set(full, { expanded: true, loading: true });
      return n;
    });
    try {
      const res = await listFiles(projectId, full, showHidden);
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { expanded: true, loading: false, children: res.entries });
        return n;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { expanded: true, loading: false, error: msg });
        return n;
      });
    }
  }, [nodeStates, projectId, setNodeStates, showHidden]);

  return (
    <>
      {entries.map((entry) => {
        const full = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        const state = nodeStates.get(full);
        return (
          <div key={full}>
            <TreeRow
              entry={entry}
              depth={depth}
              state={state}
              fullPath={full}
              selectedPath={selectedPath}
              onToggle={toggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
            {entry.type === 'directory' && state?.expanded && (
              <>
                {state.loading && (
                  <div className="flex items-center gap-1 text-xs text-warm-400 py-0.5" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>loading…</span>
                  </div>
                )}
                {state.error && (
                  <div className="flex items-center gap-1 text-xs text-red-500 py-0.5" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
                    <AlertCircle className="w-3 h-3" /> {state.error}
                  </div>
                )}
                {state.children && (
                  <TreeBranch
                    projectId={projectId}
                    parentPath={full}
                    entries={state.children}
                    depth={depth + 1}
                    nodeStates={nodeStates}
                    setNodeStates={setNodeStates}
                    showHidden={showHidden}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    onContextMenu={onContextMenu}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  entry: FileEntry;
}

interface PinnedItem {
  path: string;
  type: FileEntry['type'];
  name: string;
}

function PinnedSection({
  items, selectedPath, onSelect, onContextMenu,
}: {
  items: PinnedItem[];
  selectedPath: string | null;
  onSelect: (path: string, entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, path: string, entry: FileEntry) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="border-b border-warm-200 py-1">
      <div className="px-2 py-0.5 text-[10px] uppercase tracking-wider text-warm-400 font-medium">
        {t('files.pinned')}
      </div>
      {items.map((item) => {
        const entry: FileEntry = { name: item.name, type: item.type, size: null, mtime: null, hidden: false };
        const isSelected = selectedPath === item.path;
        return (
          <button
            key={item.path}
            type="button"
            onClick={() => onSelect(item.path, entry)}
            onContextMenu={(e) => onContextMenu(e, item.path, entry)}
            className={`w-full flex items-center gap-1.5 py-0.5 px-1 text-xs text-left rounded transition-colors ${
              isSelected ? 'bg-accent/15 text-warm-800' : 'hover:bg-warm-100 text-warm-700'
            }`}
            style={{ paddingLeft: 4 }}
            title={item.path}
          >
            <Pin className="w-3 h-3 shrink-0 text-amber-500" />
            {iconFor(entry, false)}
            <span className="truncate">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function ContextMenu({ state, projectId, isPinned, onTogglePin, onHide, onUnhide, onClose }: {
  state: ContextMenuState;
  projectId: string;
  isPinned: boolean;
  onTogglePin: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: state.y, left: state.x, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = state.x;
    let top = state.y;
    if (left + w > vw - 8) left = Math.max(8, vw - 8 - w);
    if (top + h > vh - 8) top = Math.max(8, vh - 8 - h);
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    setPos({ top, left, visible: true });
  }, [state.x, state.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const isDir = state.entry.type === 'directory';
  const callOpen = (mode: 'open' | 'reveal') => {
    openFile(projectId, state.path, mode).catch(() => { /* swallow */ });
    onClose();
  };
  const copyPath = () => {
    navigator.clipboard.writeText(state.path).catch(() => { /* swallow */ });
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="fixed z-tooltip min-w-[180px] rounded-lg py-1 shadow-elevated text-xs"
      style={{
        top: pos.top,
        left: pos.left,
        opacity: pos.visible ? 1 : 0,
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
      }}
    >
      {isDir ? (
        <button
          type="button"
          onClick={() => callOpen('open')}
          className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>{t('files.openFolder')}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => callOpen('open')}
            className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t('files.openInOS')}</span>
          </button>
          <button
            type="button"
            onClick={() => callOpen('reveal')}
            className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>{t('files.revealInExplorer')}</span>
          </button>
        </>
      )}
      <div className="my-1 border-t border-warm-200" />
      <button
        type="button"
        onClick={() => { onTogglePin(); onClose(); }}
        className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
      >
        {isPinned
          ? <PinOff className="w-3.5 h-3.5" />
          : <Pin className="w-3.5 h-3.5" />}
        <span>{isPinned ? t('files.unpin') : t('files.pin')}</span>
      </button>
      <button
        type="button"
        onClick={copyPath}
        className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
      >
        <Copy className="w-3.5 h-3.5" />
        <span>{t('files.copyPath')}</span>
      </button>
      {/* When the entry is hidden specifically by a .vaultignore pattern,
          offer to unhide (remove the pattern) instead of hide. Dotfiles /
          DEFAULT_HIDDEN aren't `ignored`, so they keep the plain "hide". */}
      {state.entry.ignored ? (
        <button
          type="button"
          onClick={() => { onUnhide(); onClose(); }}
          className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{t('files.unhide')}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { onHide(); onClose(); }}
          className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
        >
          <EyeOff className="w-3.5 h-3.5" />
          <span>{t('files.hide')}</span>
        </button>
      )}
    </div>,
    document.body,
  );
}

export function FileExplorerPanel({ projectId, activeFile, onSelectFile, onVaultIgnoreChanged }: Props) {
  const { t } = useI18n();
  const lsKey = `vault:fileExplorer:${projectId}`;
  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [nodeStates, setNodeStates] = useState<Map<string, TreeNodeState>>(new Map());
  const loadedRef = useRef(false);
  const [showHidden, setShowHidden] = useState(() => {
    try { return localStorage.getItem(`${lsKey}:showHidden`) === '1'; } catch { /* ignore */ }
    return false;
  });
  const [pinned, setPinned] = useState<PinnedItem[]>(() => {
    try {
      const raw = localStorage.getItem(`${lsKey}:pinned`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is PinnedItem =>
        x && typeof x.path === 'string' && typeof x.name === 'string' &&
        (x.type === 'file' || x.type === 'directory' || x.type === 'symlink' || x.type === 'other'),
      );
    } catch { return []; }
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    try { localStorage.setItem(`${lsKey}:pinned`, JSON.stringify(pinned)); } catch { /* ignore */ }
  }, [pinned, lsKey]);

  const pinnedPaths = useMemo(() => new Set(pinned.map(p => p.path)), [pinned]);

  const togglePin = useCallback((path: string, entry: FileEntry) => {
    setPinned((prev) => {
      if (prev.some(p => p.path === path)) return prev.filter(p => p.path !== path);
      return [...prev, { path, type: entry.type, name: entry.name }];
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(`${lsKey}:showHidden`, showHidden ? '1' : '0'); } catch { /* ignore */ }
  }, [showHidden, lsKey]);

  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      const expanded = [...nodeStates.entries()]
        .filter(([, s]) => s.expanded)
        .map(([p]) => p);
      localStorage.setItem(`${lsKey}:expanded`, JSON.stringify(expanded));
    } catch { /* ignore */ }
  }, [nodeStates, lsKey]);

  const loadRoot = useCallback(async () => {
    setRootLoading(true);
    setRootError(null);
    try {
      const res = await listFiles(projectId, '', showHidden);
      setRootEntries(res.entries);

      let savedExpanded: string[] = [];
      try {
        const raw = localStorage.getItem(`${lsKey}:expanded`);
        if (raw) savedExpanded = JSON.parse(raw);
      } catch { /* ignore */ }

      if (savedExpanded.length === 0) {
        setNodeStates(new Map());
      } else {
        const byDepth = new Map<number, string[]>();
        for (const p of savedExpanded) {
          const d = p.split('/').filter(Boolean).length;
          const arr = byDepth.get(d);
          if (arr) arr.push(p); else byDepth.set(d, [p]);
        }
        const newStates = new Map<string, TreeNodeState>();
        for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
          const results = await Promise.all(
            byDepth.get(d)!.map(async (p) => {
              try {
                const r = await listFiles(projectId, p, showHidden);
                return { path: p, entries: r.entries };
              } catch { return null; }
            }),
          );
          for (const r of results) {
            if (r) newStates.set(r.path, { expanded: true, loading: false, children: r.entries });
          }
        }
        setNodeStates(newStates);
      }
      loadedRef.current = true;
    } catch (err) {
      setRootError(err instanceof Error ? err.message : 'failed');
      setRootEntries(null);
      setNodeStates(new Map());
    } finally {
      setRootLoading(false);
    }
  }, [projectId, showHidden, lsKey]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  const handleSelect = useCallback((path: string, entry: FileEntry) => {
    if (entry.type === 'file') onSelectFile(path);
  }, [onSelectFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent, fullPath: string, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path: fullPath, entry });
  }, []);

  const handleHide = useCallback(async (path: string, entry: FileEntry) => {
    try {
      await addPathToVaultIgnore(projectId, path, entry.type === 'directory');
      await loadRoot();
      onVaultIgnoreChanged?.();
    } catch { /* swallow */ }
  }, [projectId, loadRoot, onVaultIgnoreChanged]);

  const handleUnhide = useCallback(async (path: string, entry: FileEntry) => {
    try {
      await removePathFromVaultIgnore(projectId, path, entry.type === 'directory');
      await loadRoot();
      onVaultIgnoreChanged?.();
    } catch { /* swallow */ }
  }, [projectId, loadRoot, onVaultIgnoreChanged]);

  const totalEntries = useMemo(() => rootEntries?.length ?? 0, [rootEntries]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-warm-200 text-xs">
        <span className="font-medium text-warm-700 truncate flex-1">{t('files.root')}</span>
        <span className="text-warm-400 shrink-0">{totalEntries}</span>
        <button
          onClick={() => setShowHidden((v) => !v)}
          className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
          title={showHidden ? t('files.hideHidden') : t('files.showHidden')}
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={loadRoot}
          className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
          title={t('files.refresh')}
          disabled={rootLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${rootLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1">
        <PinnedSection
          items={pinned}
          selectedPath={activeFile}
          onSelect={handleSelect}
          onContextMenu={handleContextMenu}
        />
        {rootLoading && !rootEntries && (
          <div className="flex items-center gap-1 text-xs text-warm-400 px-2 py-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t('files.loading')}
          </div>
        )}
        {rootError && (
          <div className="flex items-center gap-1 text-xs text-red-500 px-2 py-1">
            <AlertCircle className="w-3 h-3" /> {rootError}
          </div>
        )}
        {rootEntries && rootEntries.length === 0 && !rootLoading && (
          <div className="text-xs text-warm-400 px-2 py-2">{t('files.empty')}</div>
        )}
        {rootEntries && rootEntries.length > 0 && (
          <TreeBranch
            projectId={projectId}
            parentPath=""
            entries={rootEntries}
            depth={0}
            nodeStates={nodeStates}
            setNodeStates={setNodeStates}
            showHidden={showHidden}
            selectedPath={activeFile}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
          />
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          projectId={projectId}
          isPinned={pinnedPaths.has(contextMenu.path)}
          onTogglePin={() => togglePin(contextMenu.path, contextMenu.entry)}
          onHide={() => handleHide(contextMenu.path, contextMenu.entry)}
          onUnhide={() => handleUnhide(contextMenu.path, contextMenu.entry)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
