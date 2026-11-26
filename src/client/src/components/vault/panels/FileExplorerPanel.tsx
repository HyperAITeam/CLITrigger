import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown, ChevronRight, Loader2, AlertCircle, RefreshCw, EyeOff, Eye, Copy, ExternalLink, FolderOpen, FolderSymlink, Pin, PinOff, TerminalSquare, ListPlus, Square, SquareCheck, Unlink,
} from 'lucide-react';
import { useI18n } from '../../../i18n';
import { listFiles, openFile, moveFile } from '../../../api/files';
import type { FileEntry } from '../../../api/files';
import { browseNativeFolder, getProject, updateProject } from '../../../api/projects';
import { addPathToVaultIgnore, removePathFromVaultIgnore } from '../../../api/vault';
import type { VaultEdge } from '../../../api/vault';
import { collectLinkedPaths, linkAliasFromFolder } from '../../../lib/vaultLinks';
import CursorContextMenu, { ctxMenuItemClass } from '../../CursorContextMenu';
import { useSessionWindowsOptional } from '../../SessionWindowsHost';
import { useToast } from '../../../hooks/useToast';
import { iconFor, visibleTreeItems, treeRange } from '../files-utils';
import type { TreeItem } from '../files-utils';

// Shell-safe when injected into a raw terminal: quote paths containing spaces.
const quoteIfSpace = (p: string) => (/\s/.test(p) ? `"${p}"` : p);

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
  // Create an automation task referencing this file (right-click → 작업으로 보내기).
  onCreateTask?: (path: string, linkedPaths?: string[]) => void | Promise<void>;
  // Vault wikilink graph edges (relativePath from→to), used to optionally
  // include a document's linked docs when sending to a terminal/task.
  edges: VaultEdge[];
  // Bumped by VaultLayout on a server-pushed vault:changed event — reloads the tree.
  refreshToken?: number;
}

// Custom drag type carrying the dragged item's project-relative path.
const DND_PATH_TYPE = 'application/x-vault-path';

function TreeRow({
  entry, depth, state, fullPath, selectedPaths, onToggle, onSelect, onPick, onContextMenu,
  onMove, dropTargetPath, setDropTargetPath,
}: {
  entry: FileEntry;
  depth: number;
  state?: TreeNodeState;
  fullPath: string;
  selectedPaths: Set<string>;
  onToggle: (path: string, entry: FileEntry) => void;
  onSelect: (path: string, entry: FileEntry) => void;
  onPick: (e: React.MouseEvent, path: string, entry: FileEntry) => boolean;
  onContextMenu: (e: React.MouseEvent, fullPath: string, entry: FileEntry) => void;
  onMove: (from: string, destFolder: string) => void;
  dropTargetPath: string | null;
  setDropTargetPath: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { t } = useI18n();
  const isDir = entry.type === 'directory';
  const expanded = state?.expanded ?? false;
  const isSelected = selectedPaths.has(fullPath);
  const isDropTarget = isDir && dropTargetPath === fullPath;
  // The server keeps a linked folder it can't stat (deleted, unplugged drive) with mtime null.
  const missingLink = !!entry.linkPath && entry.mtime === null;

  // Folders accept drops (move into); every row is draggable (move out).
  const dropProps = isDir ? {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetPath(fullPath);
    },
    onDragLeave: () => setDropTargetPath((p) => (p === fullPath ? null : p)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const from = e.dataTransfer.getData(DND_PATH_TYPE) || e.dataTransfer.getData('text/plain');
      setDropTargetPath(null);
      if (from) onMove(from, fullPath);
    },
  } : {};

  return (
    <button
      type="button"
      draggable={!entry.linkPath}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_PATH_TYPE, fullPath);
        e.dataTransfer.setData('text/plain', fullPath);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setDropTargetPath(null)}
      {...dropProps}
      onClick={(e) => {
        if (onPick(e, fullPath, entry)) return;
        if (isDir) onToggle(fullPath, entry);
        else onSelect(fullPath, entry);
      }}
      onDoubleClick={() => { if (isDir) onSelect(fullPath, entry); }}
      onContextMenu={(e) => onContextMenu(e, fullPath, entry)}
      className={`w-full flex items-center gap-1.5 py-0.5 px-1 text-xs text-left rounded-md transition-colors ${
        isDropTarget
          ? 'bg-accent/25 ring-1 ring-accent'
          : isSelected ? 'bg-accent/15 text-warm-800' : 'hover:bg-warm-100 text-warm-700'
      }`}
      style={{ paddingLeft: 4 + depth * 12 }}
      title={missingLink ? `${entry.name} — ${t('files.linkMissing')}` : entry.name}
    >
      {isDir ? (
        expanded
          ? <ChevronDown className="w-3 h-3 shrink-0 text-warm-400" />
          : <ChevronRight className="w-3 h-3 shrink-0 text-warm-400" />
      ) : <span className="w-3 h-3 shrink-0" />}
      {iconFor(entry, expanded)}
      <span className={`truncate ${entry.hidden ? 'opacity-60 italic' : ''} ${missingLink ? 'opacity-60 line-through' : ''}`}>{entry.name}</span>
      {missingLink && <AlertCircle className="w-3 h-3 shrink-0 text-status-error" />}
    </button>
  );
}

function TreeBranch({
  projectId, parentPath, entries, depth, nodeStates, setNodeStates, showHidden, selectedPaths, onSelect, onPick, onContextMenu,
  onMove, dropTargetPath, setDropTargetPath,
}: {
  projectId: string;
  parentPath: string;
  entries: FileEntry[];
  depth: number;
  nodeStates: Map<string, TreeNodeState>;
  setNodeStates: React.Dispatch<React.SetStateAction<Map<string, TreeNodeState>>>;
  showHidden: boolean;
  selectedPaths: Set<string>;
  onSelect: (path: string, entry: FileEntry) => void;
  onPick: (e: React.MouseEvent, path: string, entry: FileEntry) => boolean;
  onContextMenu: (e: React.MouseEvent, fullPath: string, entry: FileEntry) => void;
  onMove: (from: string, destFolder: string) => void;
  dropTargetPath: string | null;
  setDropTargetPath: React.Dispatch<React.SetStateAction<string | null>>;
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
              selectedPaths={selectedPaths}
              onToggle={toggle}
              onSelect={onSelect}
              onPick={onPick}
              onContextMenu={onContextMenu}
              onMove={onMove}
              dropTargetPath={dropTargetPath}
              setDropTargetPath={setDropTargetPath}
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
                  <div className="flex items-center gap-1 text-xs text-status-error py-0.5" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
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
                    selectedPaths={selectedPaths}
                    onSelect={onSelect}
                    onPick={onPick}
                    onContextMenu={onContextMenu}
                    onMove={onMove}
                    dropTargetPath={dropTargetPath}
                    setDropTargetPath={setDropTargetPath}
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
  // Rows the actions apply to: the whole multi-selection when the clicked row is part of it, else just that row.
  targets: TreeItem[];
}

interface PinnedItem {
  path: string;
  type: FileEntry['type'];
  name: string;
}

function PinnedSection({
  items, selectedPaths, onSelect, onPick, onContextMenu,
}: {
  items: PinnedItem[];
  selectedPaths: Set<string>;
  onSelect: (path: string, entry: FileEntry) => void;
  onPick: (e: React.MouseEvent, path: string, entry: FileEntry) => boolean;
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
        const isSelected = selectedPaths.has(item.path);
        return (
          <button
            key={item.path}
            type="button"
            onClick={(e) => { if (!onPick(e, item.path, entry)) onSelect(item.path, entry); }}
            onContextMenu={(e) => onContextMenu(e, item.path, entry)}
            className={`w-full flex items-center gap-1.5 py-0.5 px-1 text-xs text-left rounded-md transition-colors ${
              isSelected ? 'bg-accent/15 text-warm-800' : 'hover:bg-warm-100 text-warm-700'
            }`}
            style={{ paddingLeft: 4 }}
            title={item.path}
          >
            <Pin className="w-3 h-3 shrink-0 text-status-warning" />
            {iconFor(entry, false)}
            <span className="truncate">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function ContextMenu({ state, projectId, realPaths, isPinned, onTogglePin, onHide, onUnhide, onLinkFolder, onUnlinkFolder, onClose, terminals, onSendToTerminal, onSendToNewTerminal, onCreateTask, linkedCount, includeLinks, onToggleIncludeLinks }: {
  state: ContextMenuState;
  projectId: string;
  // Paths to copy: the real folder path for linked-folder entries.
  realPaths: string[];
  isPinned: boolean;
  onTogglePin: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onLinkFolder: () => void;
  onUnlinkFolder: () => void;
  onClose: () => void;
  // File-only actions; undefined onCreateTask hides that item.
  terminals: { sessionId: string; label: string }[];
  onSendToTerminal: (sessionId: string) => void;
  onSendToNewTerminal: () => void;
  onCreateTask?: () => void;
  // Number of docs reachable via wikilinks; when > 0 a toggle to also send
  // them (paths) alongside this doc is offered.
  linkedCount: number;
  includeLinks: boolean;
  onToggleIncludeLinks: () => void;
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

  // "Send to terminal" cascades into a submenu to the right, opened by click
  // or by hovering the row (native-menu style delay).
  const sendRowRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState({ top: 0, left: 0, visible: false });

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  useLayoutEffect(() => {
    if (!submenuOpen) { setSubmenuPos((p) => ({ ...p, visible: false })); return; }
    const menu = ref.current;
    const row = sendRowRef.current;
    const sub = submenuRef.current;
    if (!menu || !row || !sub) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuRect = menu.getBoundingClientRect();
    const w = sub.offsetWidth;
    const h = sub.offsetHeight;
    let left = menuRect.right + 2;
    if (left + w > vw - 8) left = menuRect.left - w - 2; // flip to the left side
    if (left < 8) left = 8;
    let top = row.getBoundingClientRect().top - 4; // align first item with the row
    if (top + h > vh - 8) top = vh - 8 - h;
    if (top < 8) top = 8;
    setSubmenuPos({ top, left, visible: true });
  }, [submenuOpen, terminals.length, linkedCount]);

  // Delegated hover: over the row or the submenu wants it open, anywhere else
  // in the menu wants it closed. Leaving the menu entirely changes nothing.
  const onMenuHover = (e: React.MouseEvent) => {
    const target = e.target as Node;
    const wantOpen = !!(sendRowRef.current?.contains(target) || submenuRef.current?.contains(target));
    window.clearTimeout(hoverTimer.current);
    if (wantOpen !== submenuOpen) hoverTimer.current = window.setTimeout(() => setSubmenuOpen(wantOpen), 300);
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Scrolling the menu's own terminal list must not close it.
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
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

  const isDir = state.targets.every((target) => target.entry.type === 'directory');
  // File-only actions (send to terminal/task) show only when no folder is selected.
  const hasDir = state.targets.some((target) => target.entry.type === 'directory');
  const callOpen = (mode: 'open' | 'reveal') => {
    for (const target of state.targets) openFile(projectId, target.path, mode).catch(() => { /* swallow */ });
    onClose();
  };
  const copyPath = () => {
    navigator.clipboard.writeText(realPaths.join('\n')).catch(() => { /* swallow */ });
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      onMouseOver={onMenuHover}
      className="fixed z-tooltip min-w-[180px] rounded-lg py-1 shadow-elevated text-xs"
      style={{
        top: pos.top,
        left: pos.left,
        opacity: pos.visible ? 1 : 0,
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
      }}
    >
      {state.targets.length > 1 && (
        <div className="px-3 pt-0.5 pb-1 text-[10px] text-warm-400">
          {t('files.selectedCount').replace('{count}', String(state.targets.length))}
        </div>
      )}
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
      {!hasDir && (
        <>
          <div className="my-1 border-t border-warm-200" />
          <button
            ref={sendRowRef}
            type="button"
            onClick={() => { window.clearTimeout(hoverTimer.current); setSubmenuOpen(true); }}
            className={`w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2 ${submenuOpen ? 'bg-warm-100' : ''}`}
          >
            <TerminalSquare className="w-3.5 h-3.5" />
            <span>{t('files.sendToTerminal')}</span>
            <ChevronRight className="w-3.5 h-3.5 ml-auto text-warm-500" />
          </button>
          {submenuOpen && (
            <div
              ref={submenuRef}
              className="fixed min-w-[160px] max-w-[280px] rounded-lg py-1 shadow-elevated"
              style={{
                top: submenuPos.top,
                left: submenuPos.left,
                opacity: submenuPos.visible ? 1 : 0,
                backgroundColor: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
              }}
            >
              {linkedCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleIncludeLinks(); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-600 flex items-center gap-2"
                  >
                    {includeLinks ? <SquareCheck size={14} /> : <Square size={14} />}
                    <span>{t('files.includeLinks')} ({linkedCount})</span>
                  </button>
                  <div className="my-1 border-t border-warm-200" />
                </>
              )}
              <div className="max-h-60 overflow-y-auto">
                {terminals.map((term) => (
                  <button
                    key={term.sessionId}
                    type="button"
                    onClick={() => { onSendToTerminal(term.sessionId); onClose(); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
                  >
                    <span className="truncate">{term.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { onSendToNewTerminal(); onClose(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
              >
                <span>＋ {t('files.newTerminal')}</span>
              </button>
            </div>
          )}
          {onCreateTask && (
            <button
              type="button"
              onClick={() => { onCreateTask(); onClose(); }}
              className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>{t('files.sendToTask')}</span>
            </button>
          )}
        </>
      )}
      {/* When the entry is hidden specifically by a .vaultignore pattern,
          offer to unhide (remove the pattern) instead of hide. Dotfiles /
          DEFAULT_HIDDEN aren't `ignored`, so they keep the plain "hide".
          A linked folder's own `@alias` entry can't be hidden, only unlinked. */}
      {state.entry.linkPath ? (
        <button
          type="button"
          onClick={() => { onUnlinkFolder(); onClose(); }}
          className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-status-error flex items-center gap-2"
        >
          <Unlink className="w-3.5 h-3.5" />
          <span>{t('files.unlinkFolder')}</span>
        </button>
      ) : state.entry.ignored ? (
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
      <div className="my-1 border-t border-warm-200" />
      <button
        type="button"
        onClick={() => { onLinkFolder(); onClose(); }}
        className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
      >
        <FolderSymlink className="w-3.5 h-3.5" />
        <span>{t('files.linkFolder')}</span>
      </button>
    </div>,
    document.body,
  );
}

export function FileExplorerPanel({ projectId, activeFile, onSelectFile, onVaultIgnoreChanged, onCreateTask, edges, refreshToken }: Props) {
  const { t } = useI18n();
  const windows = useSessionWindowsOptional();
  const { success, error: toastError } = useToast();
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
  // Right-click on the header or empty space (not on a row).
  const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null);
  // "Include linked docs" toggle for the send-to-terminal/task actions. Sticky
  // across right-clicks; the toggle row only shows when the target has links.
  const [includeLinks, setIncludeLinks] = useState(false);
  // Docs linked from any of the menu targets, minus the targets themselves.
  const linkedPaths = useMemo(() => {
    if (!contextMenu) return [];
    const targetPaths = new Set(contextMenu.targets.map((target) => target.path));
    const linked = new Set(contextMenu.targets.flatMap((target) => collectLinkedPaths(edges, target.path)));
    return [...linked].filter((path) => !targetPaths.has(path));
  }, [contextMenu, edges]);
  // Ctrl/Shift-click multi-selection, in click order. Empty = only the open
  // file is highlighted; a plain click empties it and sets the Shift anchor.
  const [selection, setSelection] = useState<Map<string, FileEntry>>(new Map());
  const anchorRef = useRef<string | null>(null);
  useEffect(() => { setSelection(new Map()); anchorRef.current = activeFile; }, [activeFile]);
  // Folder path currently hovered as a drag-and-drop target ('' = root header).
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(`${lsKey}:pinned`, JSON.stringify(pinned)); } catch { /* ignore */ }
  }, [pinned, lsKey]);

  const pinnedPaths = useMemo(() => new Set(pinned.map(p => p.path)), [pinned]);

  // All targets already pinned → unpin them all; otherwise pin the rest.
  const togglePin = useCallback((targets: TreeItem[]) => {
    setPinned((prev) => {
      const pinnedSet = new Set(prev.map(p => p.path));
      if (targets.every(target => pinnedSet.has(target.path))) {
        const targetPaths = new Set(targets.map(target => target.path));
        return prev.filter(p => !targetPaths.has(p.path));
      }
      return [...prev, ...targets.filter(target => !pinnedSet.has(target.path))
        .map(target => ({ path: target.path, type: target.entry.type, name: target.entry.name }))];
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

  // External change pushed over WS — the mount effect above already covers token 0.
  useEffect(() => {
    if ((refreshToken ?? 0) > 0) loadRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleSelect = useCallback((path: string, entry: FileEntry) => {
    if (entry.type === 'file') onSelectFile(path);
  }, [onSelectFile]);

  // Returns true when a Ctrl/Shift click only changed the selection (row skips open/toggle).
  const handlePick = useCallback((e: React.MouseEvent, path: string, entry: FileEntry) => {
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      anchorRef.current = path;
      setSelection(new Map());
      return false;
    }
    // Render order: project tree first, linked `@alias` folders in their own section below.
    const roots = rootEntries ?? [];
    const items = visibleTreeItems([...roots.filter((r) => !r.linkPath), ...roots.filter((r) => r.linkPath)], (p) => {
      const state = nodeStates.get(p);
      return state?.expanded ? state.children : undefined;
    });
    if (e.shiftKey) {
      const range = treeRange(items, anchorRef.current, path);
      setSelection(new Map((range.length ? range : [{ path, entry }]).map((item) => [item.path, item.entry])));
      return true;
    }
    // Ctrl-click toggles; the first one starts from the open file, which is what's highlighted.
    const active = items.find((item) => item.path === activeFile);
    setSelection((prev) => {
      const next = new Map(prev.size || !active ? prev : [[active.path, active.entry]]);
      if (next.has(path)) next.delete(path); else next.set(path, entry);
      return next;
    });
    anchorRef.current = path;
    return true;
  }, [rootEntries, nodeStates, activeFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent, fullPath: string, entry: FileEntry) => {
    e.preventDefault();
    const inSelection = selection.has(fullPath);
    if (!inSelection) setSelection(new Map());
    const targets = inSelection ? [...selection].map(([path, selectedEntry]) => ({ path, entry: selectedEntry })) : [{ path: fullPath, entry }];
    setContextMenu({ x: e.clientX, y: e.clientY, path: fullPath, entry, targets });
  }, [selection]);

  // Rows preventDefault in handleContextMenu before the event bubbles here.
  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    setBackgroundMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Sequential: each call rewrites .vaultignore on the server.
  const handleHide = useCallback(async (targets: TreeItem[]) => {
    try {
      for (const target of targets) await addPathToVaultIgnore(projectId, target.path, target.entry.type === 'directory');
      await loadRoot();
      onVaultIgnoreChanged?.();
    } catch { /* swallow */ }
  }, [projectId, loadRoot, onVaultIgnoreChanged]);

  const handleUnhide = useCallback(async (targets: TreeItem[]) => {
    try {
      for (const target of targets) await removePathFromVaultIgnore(projectId, target.path, target.entry.type === 'directory');
      await loadRoot();
      onVaultIgnoreChanged?.();
    } catch { /* swallow */ }
  }, [projectId, loadRoot, onVaultIgnoreChanged]);

  // Drag-and-drop move. `destFolder` is the target folder's path ('' = root).
  // Simple move only (fs.rename) — name-based wikilinks survive; path-based
  // references may need manual fixing.
  const handleMove = useCallback(async (from: string, destFolder: string) => {
    const name = from.split('/').filter(Boolean).pop() ?? from;
    const to = destFolder ? `${destFolder}/${name}` : name;
    const fromParent = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    // No-op when already in that folder; can't move a folder into itself/descendant.
    if (from === to || fromParent === destFolder) return;
    if (destFolder === from || destFolder.startsWith(from + '/')) return;
    try {
      await moveFile(projectId, from, to);
      await loadRoot();
      onVaultIgnoreChanged?.();
    } catch (err) {
      console.warn('[vault] move failed:', err);
    }
  }, [projectId, loadRoot, onVaultIgnoreChanged]);

  // Linked doc folders (`@alias`, projects.vault_links) come back in the root
  // listing but are shown as their own section below the project tree.
  const projectEntries = useMemo(() => rootEntries?.filter((e) => !e.linkPath) ?? null, [rootEntries]);
  const linkedEntries = useMemo(() => rootEntries?.filter((e) => e.linkPath) ?? [], [rootEntries]);
  const totalEntries = projectEntries?.length ?? 0;

  // Pick a folder outside the project and link it as `@<folder name>`.
  const handleLinkFolder = useCallback(async () => {
    let picked: string | null;
    try {
      picked = (await browseNativeFolder()).path;
    } catch { return; /* user cancelled */ }
    if (!picked) return;
    try {
      // Append to the stored list, not the tree's copy — that is empty while the tree is loading or failed.
      const stored = (await getProject(projectId)).vault_links;
      const links: { alias: string; path: string }[] = stored ? JSON.parse(stored) : [];
      await updateProject(projectId, { vault_links: JSON.stringify([...links, { alias: linkAliasFromFolder(picked), path: picked }]) });
      await loadRoot();
      onVaultIgnoreChanged?.();
    } catch (err) {
      // Rejected by the server (duplicate alias, overlaps the project folder) — say why.
      if (err instanceof Error) toastError(err.message);
    }
  }, [projectId, loadRoot, onVaultIgnoreChanged, toastError]);

  // Drop the `@alias` link only; the folder's files are left alone.
  const handleUnlinkFolder = useCallback(async (entries: FileEntry[]) => {
    const names = new Set(entries.map((entry) => entry.name));
    try {
      const stored = (await getProject(projectId)).vault_links;
      const links: { alias: string; path: string }[] = stored ? JSON.parse(stored) : [];
      await updateProject(projectId, { vault_links: JSON.stringify(links.filter((link) => !names.has(`@${link.alias}`))) });
      await loadRoot();
      onVaultIgnoreChanged?.();
    } catch (err) {
      if (err instanceof Error) toastError(err.message);
    }
  }, [projectId, loadRoot, onVaultIgnoreChanged, toastError]);

  // `@alias/...` paths of linked doc folders only mean something inside the
  // app; terminals and the clipboard get the real path.
  const toRealPath = useCallback((p: string) => {
    const slash = p.indexOf('/');
    const head = slash < 0 ? p : p.slice(0, slash);
    const linkPath = rootEntries?.find((e) => e.linkPath && e.name === head)?.linkPath;
    return linkPath ? linkPath + (slash < 0 ? '' : p.slice(slash)) : p;
  }, [rootEntries]);

  const highlightedPaths = useMemo(
    () => new Set(selection.size ? selection.keys() : activeFile ? [activeFile] : []),
    [selection, activeFile],
  );
  const menuTargets = contextMenu?.targets ?? [];
  // Menu targets first, then (when toggled) the docs they link to.
  const sendPaths = [...menuTargets.map((target) => target.path), ...(includeLinks ? linkedPaths : [])];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={`flex items-center gap-1 px-2 py-1.5 border-b border-warm-200 text-xs transition-colors ${
          dropTargetPath === '' ? 'bg-accent/20 ring-1 ring-accent ring-inset' : ''
        }`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetPath(''); }}
        onDragLeave={() => setDropTargetPath((p) => (p === '' ? null : p))}
        onDrop={(e) => {
          e.preventDefault();
          const from = e.dataTransfer.getData(DND_PATH_TYPE) || e.dataTransfer.getData('text/plain');
          setDropTargetPath(null);
          if (from) handleMove(from, '');
        }}
        onContextMenu={handleBackgroundContextMenu}
      >
        <span className="font-medium text-warm-700 truncate flex-1">{t('files.root')}</span>
        <span className="text-warm-400 shrink-0">{totalEntries}</span>
        <button
          onClick={() => setShowHidden((v) => !v)}
          className="p-1 rounded-md hover:bg-warm-100 text-warm-500 hover:text-warm-700"
          title={showHidden ? t('files.hideHidden') : t('files.showHidden')}
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={loadRoot}
          className="p-1 rounded-md hover:bg-warm-100 text-warm-500 hover:text-warm-700"
          title={t('files.refresh')}
          disabled={rootLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${rootLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1 select-none" onContextMenu={handleBackgroundContextMenu}>
        <PinnedSection
          items={pinned}
          selectedPaths={highlightedPaths}
          onSelect={handleSelect}
          onPick={handlePick}
          onContextMenu={handleContextMenu}
        />
        {rootLoading && !rootEntries && (
          <div className="flex items-center gap-1 text-xs text-warm-400 px-2 py-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t('files.loading')}
          </div>
        )}
        {rootError && (
          <div className="flex items-center gap-1 text-xs text-status-error px-2 py-1">
            <AlertCircle className="w-3 h-3" /> {rootError}
          </div>
        )}
        {projectEntries && projectEntries.length === 0 && !rootLoading && (
          <div className="text-xs text-warm-400 px-2 py-2">{t('files.empty')}</div>
        )}
        {projectEntries && projectEntries.length > 0 && (
          <TreeBranch
            projectId={projectId}
            parentPath=""
            entries={projectEntries}
            depth={0}
            nodeStates={nodeStates}
            setNodeStates={setNodeStates}
            showHidden={showHidden}
            selectedPaths={highlightedPaths}
            onSelect={handleSelect}
            onPick={handlePick}
            onContextMenu={handleContextMenu}
            onMove={handleMove}
            dropTargetPath={dropTargetPath}
            setDropTargetPath={setDropTargetPath}
          />
        )}
        {linkedEntries.length > 0 && (
          <div className="mt-1 border-t border-warm-200 pt-1">
            <div className="px-2 py-0.5 text-[10px] uppercase tracking-wider text-warm-400 font-medium">
              {t('header.vaultLinksTitle')}
            </div>
            <TreeBranch
              projectId={projectId}
              parentPath=""
              entries={linkedEntries}
              depth={0}
              nodeStates={nodeStates}
              setNodeStates={setNodeStates}
              showHidden={showHidden}
              selectedPaths={highlightedPaths}
              onSelect={handleSelect}
              onPick={handlePick}
              onContextMenu={handleContextMenu}
              onMove={handleMove}
              dropTargetPath={dropTargetPath}
              setDropTargetPath={setDropTargetPath}
            />
          </div>
        )}
      </div>
      {backgroundMenu && (
        <CursorContextMenu x={backgroundMenu.x} y={backgroundMenu.y} onClose={() => setBackgroundMenu(null)}>
          <button type="button" className={ctxMenuItemClass} onClick={handleLinkFolder}>
            <FolderSymlink className="w-3.5 h-3.5" />
            <span>{t('files.linkFolder')}</span>
          </button>
        </CursorContextMenu>
      )}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          projectId={projectId}
          realPaths={menuTargets.map((target) => toRealPath(target.path))}
          isPinned={menuTargets.every((target) => pinnedPaths.has(target.path))}
          onTogglePin={() => togglePin(menuTargets)}
          onHide={() => handleHide(menuTargets.filter((target) => !target.entry.linkPath && !target.entry.ignored))}
          onUnhide={() => handleUnhide(menuTargets.filter((target) => target.entry.ignored))}
          onLinkFolder={handleLinkFolder}
          onUnlinkFolder={() => handleUnlinkFolder(menuTargets.filter((target) => target.entry.linkPath).map((target) => target.entry))}
          onClose={() => setContextMenu(null)}
          linkedCount={linkedPaths.length}
          includeLinks={includeLinks}
          onToggleIncludeLinks={() => setIncludeLinks((v) => !v)}
          terminals={windows?.listOpenTerminals() ?? []}
          onSendToTerminal={(sessionId) => {
            if (!windows) return;
            windows.sendToSession(sessionId, sendPaths.map(toRealPath).map(quoteIfSpace).join(' '));
            success(t('files.sentToTerminal'));
          }}
          onSendToNewTerminal={() => {
            if (!windows) return;
            windows.sendToNewTerminal(sendPaths.map(toRealPath).map(quoteIfSpace).join(' '), contextMenu.entry.name).catch(() => { /* swallow — createSession error */ });
            success(t('files.sentToTerminal'));
          }}
          onCreateTask={onCreateTask ? async () => {
            // One task referencing every target; it's named after the first.
            try { await onCreateTask(sendPaths[0], sendPaths.slice(1)); success(t('files.taskCreated')); }
            catch { toastError(t('files.taskCreateFailed')); }
          } : undefined}
        />
      )}
    </div>
  );
}
