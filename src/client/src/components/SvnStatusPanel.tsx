import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Folder, FolderTree, List } from 'lucide-react';
import type { Project } from '../types';
import * as svnApi from '../api/svn';
import type { SvnFile, SvnStatusResult } from '../api/svn';
import type { CommitFile, GitLogEntry, GitStatusFile } from '../api/projects';
import { getCliStatus } from '../api/cli-status';
import { useI18n } from '../i18n';
import Modal from './Modal';
import { CommitDiffViewer, CommitFileList } from './DiffViewer';

interface SvnStatusPanelProps {
  project: Project;
  refreshTrigger?: number;
}

type View = 'modifications' | 'log';

// Module-level cache of the last LOCAL status per project. Survives the
// key={project.id} remount so revisiting a project shows the previous result
// instantly while a fresh `svn status` runs in the background.
// ponytail: unbounded Map, projects are few; add eviction only if it matters.
const statusCache = new Map<string, SvnStatusResult>();

const charOf = (f: GitStatusFile) => f.working_dir.trim() || '?';

const charColor = (ch: string) =>
  ch === 'A' ? 'text-status-success'
    : ch === 'D' ? 'text-status-error'
    : ch === 'M' ? 'text-accent'
    : ch === 'C' ? 'text-status-error'
    : ch === '?' ? 'text-warm-400'
    : 'text-amber-500';

const SVN_COMMIT_MESSAGE_HEIGHT_KEY = 'clitrigger:svn:commit-message-h';
const SVN_COMMIT_MESSAGE_MIN_HEIGHT = 60;
const SVN_COMMIT_MESSAGE_MAX_HEIGHT = 280;
const SVN_COMMIT_FILE_LIST_MIN_HEIGHT = 160;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? clampNumber(value, min, max) : fallback;
}

export default function SvnStatusPanel({ project, refreshTrigger }: SvnStatusPanelProps) {
  const { t } = useI18n();

  // Always land on the local "Check for modifications" view. Server-contacting
  // views (log) are never the restored default — they must be opened explicitly.
  const [view, setView] = useState<View>('modifications');

  const [error, setError] = useState<string | null>(null);
  const [actionFlash, setActionFlash] = useState<string | null>(null);
  const [svnInstalled, setSvnInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCliStatus()
      .then((list) => {
        if (cancelled) return;
        const svn = list.find((s) => s.tool === 'svn');
        setSvnInstalled(svn ? svn.installed : null);
      })
      .catch(() => { /* leave as null — banner suppressed */ });
    return () => { cancelled = true; };
  }, []);

  // ── Working copy status (LOCAL: `svn status`) ────────────────────────────
  const [status, setStatus] = useState<SvnStatusResult | null>(
    () => statusCache.get(project.id) ?? null,
  );
  const [statusLoading, setStatusLoading] = useState(false);
  const [remoteChecking, setRemoteChecking] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [workingDiff, setWorkingDiff] = useState<string>('');
  const [workingDiffLoading, setWorkingDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const applyStatus = useCallback((s: SvnStatusResult) => {
    statusCache.set(project.id, s);
    setStatus(s);
    setSelectedFiles((prev) => {
      const valid = new Set(s.files.map((f) => f.path));
      const next = new Set<string>();
      prev.forEach((p) => valid.has(p) && next.add(p));
      return next;
    });
    setActiveFile((prev) => (prev && !s.files.some((f) => f.path === prev) ? null : prev));
  }, [project.id]);

  // LOCAL only — safe to run on mount / refreshTrigger. Never adds --show-updates.
  // With a cached result, skip the loading gate so the previous file list stays
  // visible and gets replaced silently once the fresh scan finishes.
  const refreshStatus = useCallback(async () => {
    const hasCache = statusCache.has(project.id);
    if (!hasCache) setStatusLoading(true);
    setError(null);
    try {
      applyStatus(await svnApi.getSvnStatus(project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SVN status');
    } finally {
      if (!hasCache) setStatusLoading(false);
    }
  }, [project.id, applyStatus]);

  useEffect(() => { refreshStatus(); }, [refreshStatus, refreshTrigger]);

  // SERVER: `svn status -u`. Only ever called from the explicit button.
  const checkRepository = useCallback(async () => {
    setRemoteChecking(true);
    setError(null);
    setActionFlash(null);
    try {
      const s = await svnApi.getSvnStatus(project.id, true);
      applyStatus(s);
      setActionFlash(s.behind > 0 ? t('svn.behindCount').replace('{n}', String(s.behind)) : t('svn.upToDate'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to contact server');
    } finally {
      setRemoteChecking(false);
    }
  }, [project.id, applyStatus, t]);

  useEffect(() => {
    if (!activeFile) { setWorkingDiff(''); return; }
    let cancelled = false;
    setWorkingDiffLoading(true);
    svnApi.getSvnDiff(project.id, activeFile)
      .then((r) => { if (!cancelled) setWorkingDiff(r.diff); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Diff failed'); })
      .finally(() => { if (!cancelled) setWorkingDiffLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, activeFile]);

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const selectMany = (paths: string[], select: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => { if (select) next.add(p); else next.delete(p); });
      return next;
    });
  };

  const runAction = async (action: () => Promise<unknown>, successMsg?: string) => {
    setActionBusy(true);
    setError(null);
    setActionFlash(null);
    try {
      await action();
      if (successMsg) setActionFlash(successMsg);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionBusy(false);
    }
  };

  // ── File-level operations (LOCAL) — invoked from the row context menu ─────
  const doAdd = (files: string[]) => runAction(() => svnApi.svnAdd(project.id, files));
  const doRevert = (files: string[]) => runAction(() => svnApi.svnRevert(project.id, files));
  const doDelete = (files: string[]) => runAction(() => svnApi.svnDelete(project.id, files));
  const doResolve = (files: string[], accept: 'working' | 'mine-full' | 'theirs-full' | 'base') =>
    runAction(() => svnApi.svnResolve(project.id, files, accept));
  const doChangelist = (name: string | null, files: string[]) =>
    runAction(() => svnApi.svnChangelist(project.id, name, files));

  // ── Global commands ───────────────────────────────────────────────────────
  // Files `svn update` reported as conflicted ('C' in any status column) —
  // shown as a warning banner until every 'C' row is resolved.
  const [updateConflicts, setUpdateConflicts] = useState<string[] | null>(null);
  const applyUpdateResult = (r: { revision: string | null; conflicts: string[] }) => {
    if (r.conflicts.length > 0) {
      setUpdateConflicts(r.conflicts);
    } else {
      setActionFlash(r.revision ? t('svn.updateSuccess').replace('{rev}', r.revision) : t('svn.update'));
    }
  };
  const handleUpdate = () =>
    runAction(async () => {
      applyUpdateResult(await svnApi.svnUpdate(project.id));
    });

  const [showRevDialog, setShowRevDialog] = useState(false);
  const [revInput, setRevInput] = useState('');
  const handleUpdateToRevision = () => {
    const rev = revInput.trim();
    if (!rev) return;
    setShowRevDialog(false);
    runAction(async () => {
      applyUpdateResult(await svnApi.svnUpdate(project.id, rev));
      setRevInput('');
    });
  };

  const handleCleanup = () =>
    runAction(() => svnApi.svnCleanup(project.id), t('svn.cleanupSuccess'));

  // ── New changelist dialog. Non-null = files pending assignment. ───────────
  const [clDialogFiles, setClDialogFiles] = useState<string[] | null>(null);
  const [clNameInput, setClNameInput] = useState('');
  const handleNewChangelist = () => {
    const name = clNameInput.trim();
    if (!name || !clDialogFiles) return;
    const files = clDialogFiles;
    setClDialogFiles(null);
    setClNameInput('');
    doChangelist(name, files);
  };

  const handleCommit = () => {
    if (!commitMessage.trim()) {
      setError(t('svn.commitMessagePlaceholder'));
      return;
    }
    const files = selectedFiles.size > 0 ? Array.from(selectedFiles) : undefined;
    runAction(async () => {
      const r = await svnApi.svnCommit(project.id, commitMessage.trim(), files);
      setCommitMessage('');
      if (r.revision) setActionFlash(t('svn.commitSuccess').replace('{rev}', r.revision));
    });
  };

  // ── Log (SERVER: `svn log`) — fetched only on explicit user action ────────
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logHasMore, setLogHasMore] = useState(false);
  const [selectedRev, setSelectedRev] = useState<string | null>(null);
  const [revFiles, setRevFiles] = useState<CommitFile[]>([]);
  const [revFilesLoading, setRevFilesLoading] = useState(false);
  const [revSelectedFile, setRevSelectedFile] = useState<string | null>(null);
  const [revDiff, setRevDiff] = useState('');
  const [revDiffLoading, setRevDiffLoading] = useState(false);

  const loadLog = useCallback(async (skip = 0) => {
    setLogLoading(true);
    setError(null);
    try {
      const r = await svnApi.getSvnLog(project.id, skip, 50);
      setLogEntries((prev) => (skip === 0 ? r.commits : [...prev, ...r.commits]));
      setLogHasMore(r.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log failed');
    } finally {
      setLogLoading(false);
    }
  }, [project.id]);

  const selectRevision = useCallback(async (rev: string) => {
    setSelectedRev(rev);
    setRevSelectedFile(null);
    setRevDiff('');
    setRevFilesLoading(true);
    try {
      const r = await svnApi.getSvnCommitFiles(project.id, rev);
      setRevFiles(r.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load revision files');
    } finally {
      setRevFilesLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!selectedRev || !revSelectedFile) { setRevDiff(''); return; }
    let cancelled = false;
    setRevDiffLoading(true);
    const status = revFiles.find((f) => f.path === revSelectedFile)?.status;
    svnApi.getSvnCommitDiff(project.id, selectedRev, revSelectedFile, status)
      .then((r) => { if (!cancelled) setRevDiff(r.diff); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Diff failed'); })
      .finally(() => { if (!cancelled) setRevDiffLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, selectedRev, revSelectedFile, revFiles]);

  // ── Row context menu ──────────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: GitStatusFile } | null>(null);

  // ── Properties dialog (LOCAL). null = closed; { file: null } = WC root. ───
  const [propsTarget, setPropsTarget] = useState<{ file: string | null } | null>(null);

  const openCtxMenu = (e: React.MouseEvent, file: GitStatusFile) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, file });
  };

  const changelistNames = useMemo(
    () => Array.from(new Set((status?.files ?? []).map((f) => f.changelist).filter((n): n is string => !!n))).sort(),
    [status],
  );

  const repoLine = useMemo(() => {
    if (!status) return null;
    const parts: string[] = [];
    if (status.branch) parts.push(status.branch);
    if (status.revision) parts.push(`r${status.revision}`);
    return parts.join('  ·  ');
  }, [status]);

  const busy = actionBusy || statusLoading || remoteChecking;

  // Auto-dismiss the update-conflict banner once no 'C' rows remain.
  useEffect(() => {
    if (!updateConflicts) return;
    if (status && !status.files.some((f) => f.working_dir === 'C')) setUpdateConflicts(null);
  }, [status, updateConflicts]);

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}>
      {svnInstalled === false && (
        <div className="card mb-2 px-3 py-2 bg-status-warning/10 border border-status-warning/30 text-2xs text-status-warning">
          {t('svn.cliMissing')}
        </div>
      )}
      {updateConflicts && updateConflicts.length > 0 && (
        <div className="card mb-2 px-3 py-2 bg-status-warning/10 border border-status-warning/30 text-2xs text-status-warning flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{t('svn.updateConflicts').replace('{n}', String(updateConflicts.length))}</div>
            <div className="mt-0.5 truncate" title={updateConflicts.join(', ')}>
              {updateConflicts.slice(0, 5).join(', ')}{updateConflicts.length > 5 ? ` … (+${updateConflicts.length - 5})` : ''}
            </div>
          </div>
          <button onClick={() => setUpdateConflicts(null)} className="shrink-0 hover:opacity-70">&times;</button>
        </div>
      )}
      <div className="flex flex-1 min-h-0 gap-2">
        {/* Command list sidebar (TortoiseSVN-style) */}
        <div className="card w-52 shrink-0 flex flex-col overflow-y-auto">
          <div className="px-3 py-3 border-b border-warm-100">
            <div className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">SVN</div>
            {repoLine && (
              <div className="mt-1 text-2xs text-warm-400 truncate" title={status?.tracking ?? undefined}>
                {repoLine}
              </div>
            )}
          </div>

          <SidebarHeader label={t('svn.viewsHeader')} />
          <CmdButton
            label={t('svn.checkForModifications')}
            active={view === 'modifications'}
            onClick={() => setView('modifications')}
          />
          <CmdButton
            label={t('svn.showLog')}
            remote
            active={view === 'log'}
            onClick={() => setView('log')}
          />

          <SidebarHeader label={t('svn.actionsHeader')} />
          <CmdButton label={t('svn.update')} remote disabled={busy} onClick={handleUpdate} />
          <CmdButton label={t('svn.updateToRevision')} remote disabled={busy} onClick={() => setShowRevDialog(true)} />
          <CmdButton label={t('svn.cleanup')} disabled={busy} onClick={handleCleanup} />
          <CmdButton label={t('svn.properties')} onClick={() => setPropsTarget({ file: null })} />

          <div className="flex-1" />
        </div>

        {/* Main */}
        <div className="card flex-1 overflow-hidden flex flex-col min-w-0 min-h-0">
          {view === 'modifications' ? (
            <ModificationsView
              statusFiles={status?.files ?? []}
              statusLoading={statusLoading}
              remoteChecking={remoteChecking}
              onRefresh={refreshStatus}
              onCheckRepository={checkRepository}
              selectedFiles={selectedFiles}
              onToggle={toggleFile}
              onSelectMany={selectMany}
              activeFile={activeFile}
              onActivate={setActiveFile}
              onContextMenu={openCtxMenu}
              onChangelist={doChangelist}
              onResolve={(p, accept) => doResolve([p], accept)}
              workingDiff={workingDiff}
              workingDiffLoading={workingDiffLoading}
              commitMessage={commitMessage}
              onCommitMessageChange={setCommitMessage}
              onCommit={handleCommit}
              busy={busy}
              actionFlash={actionFlash}
              error={error}
            />
          ) : (
            <LogView
              loaded={logEntries.length > 0}
              entries={logEntries}
              loading={logLoading}
              hasMore={logHasMore}
              onLoad={() => loadLog(0)}
              onLoadMore={() => loadLog(logEntries.length)}
              selectedRev={selectedRev}
              onSelectRev={selectRevision}
              revFiles={revFiles}
              revFilesLoading={revFilesLoading}
              selectedFile={revSelectedFile}
              onSelectFile={setRevSelectedFile}
              revDiff={revDiff}
              revDiffLoading={revDiffLoading}
              error={error}
            />
          )}
        </div>
      </div>

      {/* Update to revision dialog */}
      <Modal open={showRevDialog} onClose={() => setShowRevDialog(false)} size="sm">
        <div className="bg-theme-card rounded-lg shadow-xl w-80 max-w-[90vw]">
          <div className="px-4 py-3 border-b border-warm-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-warm-700">{t('svn.updateToRevision')}</span>
            <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {t('svn.remoteBadge')}
            </span>
          </div>
          <div className="p-4 space-y-3">
            <input
              autoFocus
              value={revInput}
              onChange={(e) => setRevInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateToRevision(); }}
              placeholder={t('svn.revisionPlaceholder')}
              className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-2 text-sm rounded border border-warm-200 hover:bg-warm-50"
                onClick={() => setShowRevDialog(false)}
              >
                {t('svn.cancel')}
              </button>
              <button
                className="flex-1 px-3 py-2 text-sm font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
                disabled={!revInput.trim() || busy}
                onClick={handleUpdateToRevision}
              >
                {t('svn.update')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* New changelist dialog */}
      <Modal open={clDialogFiles !== null} onClose={() => setClDialogFiles(null)} size="sm">
        <div className="bg-theme-card rounded-lg shadow-xl w-80 max-w-[90vw]">
          <div className="px-4 py-3 border-b border-warm-100">
            <span className="text-sm font-semibold text-warm-700">{t('svn.newChangelist')}</span>
          </div>
          <div className="p-4 space-y-3">
            <input
              autoFocus
              value={clNameInput}
              onChange={(e) => setClNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNewChangelist(); }}
              placeholder={t('svn.changelistNamePlaceholder')}
              className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-2 text-sm rounded border border-warm-200 hover:bg-warm-50"
                onClick={() => setClDialogFiles(null)}
              >
                {t('svn.cancel')}
              </button>
              <button
                className="flex-1 px-3 py-2 text-sm font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
                disabled={!clNameInput.trim() || busy}
                onClick={handleNewChangelist}
              >
                {t('svn.moveToChangelist')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* File row context menu */}
      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          file={ctxMenu.file}
          allFiles={status?.files ?? []}
          selected={selectedFiles}
          onClose={() => setCtxMenu(null)}
          onAdd={doAdd}
          onRevert={doRevert}
          onDelete={doDelete}
          onResolve={doResolve}
          changelists={changelistNames}
          onChangelist={doChangelist}
          onNewChangelist={(files) => setClDialogFiles(files)}
          onViewDiff={(p) => { setActiveFile(p); setCtxMenu(null); }}
          onProperties={(p) => { setPropsTarget({ file: p }); setCtxMenu(null); }}
        />
      )}

      {propsTarget && (
        <PropertiesDialog projectId={project.id} file={propsTarget.file} onClose={() => setPropsTarget(null)} />
      )}
    </div>
  );
}

// ── Sidebar primitives ──────────────────────────────────────────────────────

function SidebarHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold text-warm-400 uppercase tracking-wider">
      {label}
    </div>
  );
}

function CmdButton({ label, active, remote, disabled, onClick }: {
  label: string;
  active?: boolean;
  remote?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors disabled:opacity-40 ${
        active ? 'bg-accent/10 text-accent font-semibold border-l-2 border-accent' : 'text-warm-600 hover:bg-warm-50'
      }`}
    >
      <span className="truncate flex-1">{label}</span>
      {remote && (
        <span
          title={t('svn.remoteHint')}
          className="shrink-0 text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        >
          {t('svn.remoteBadge')}
        </span>
      )}
    </button>
  );
}

// ── Directory tree grouping (LOCAL modifications) ────────────────────────────

interface DirTree {
  name: string;              // segment name; compacted chains join with '/'
  path: string;              // full path of this dir (post-compaction)
  dirs: DirTree[];
  files: GitStatusFile[];
}

function buildDirTree(files: GitStatusFile[]): DirTree {
  const root: DirTree = { name: '', path: '', dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    parts.pop(); // drop the file name; only dir segments remain
    let node = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.dirs.find((d) => d.name === part);
      if (!child) {
        child = { name: part, path: acc, dirs: [], files: [] };
        node.dirs.push(child);
      }
      node = child;
    }
    node.files.push(f);
  }
  compactDirs(root);
  sortDir(root);
  return root;
}

// IntelliJ-style: collapse a chain of single-child dirs (no direct files) into
// one row named "parent/child/…".
function compactDirs(node: DirTree): void {
  node.dirs = node.dirs.map((d) => {
    let cur = d;
    while (cur.dirs.length === 1 && cur.files.length === 0) {
      const only = cur.dirs[0];
      cur = { name: `${cur.name}/${only.name}`, path: only.path, dirs: only.dirs, files: only.files };
    }
    return cur;
  });
  node.dirs.forEach(compactDirs);
}

function sortDir(node: DirTree): void {
  node.dirs.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.path.localeCompare(b.path));
  node.dirs.forEach(sortDir);
}

function countDir(node: DirTree): { dirs: number; files: number } {
  let dirs = node.dirs.length;
  let files = node.files.length;
  for (const d of node.dirs) {
    const c = countDir(d);
    dirs += c.dirs;
    files += c.files;
  }
  return { dirs, files };
}

interface FileRowShared {
  selectedFiles: Set<string>;
  activeFile: string | null;
  onActivate: (path: string) => void;
  onToggle: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, file: GitStatusFile) => void;
  onDragStart: (e: React.DragEvent, file: GitStatusFile) => void;
  onResolve: (path: string, accept: 'working' | 'mine-full' | 'theirs-full') => void;
}

// Inline conflict resolver shown on conflicted ('C') rows — the common accept
// modes without opening the full context menu. Base/other modes stay there.
function ConflictResolveButton({ onResolve, onOpen }: {
  onResolve: (accept: 'working' | 'mine-full' | 'theirs-full') => void;
  // Activates the row so the diff pane previews the conflict before picking.
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen?.();
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Clamp to viewport (menu ≈ 180×140).
    const x = Math.min(r.left, window.innerWidth - 188);
    const y = Math.min(r.bottom + 2, window.innerHeight - 148);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  };

  const pick = (accept: 'working' | 'mine-full' | 'theirs-full') => (e: React.MouseEvent) => {
    e.stopPropagation();
    setPos(null);
    onResolve(accept);
  };

  return (
    <>
      <button
        ref={btnRef}
        draggable={false}
        onClick={open}
        className="shrink-0 text-2xs px-1.5 py-0.5 rounded bg-status-error/15 text-status-error hover:bg-status-error/25 font-medium"
      >
        {t('svn.resolve')} ▾
      </button>
      {pos && createPortal(
        <div
          className="fixed z-tooltip bg-theme-card border border-warm-200 dark:border-warm-700 rounded-lg shadow-elevated py-1 min-w-[180px]"
          style={{ left: pos.x, top: pos.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-warm-500 hover:bg-theme-hover transition-colors border-b border-warm-100 dark:border-warm-700"
            onClick={(e) => { e.stopPropagation(); onOpen?.(); setPos(null); }}
          >
            {t('svn.previewDiff')}
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-theme-text hover:bg-theme-hover transition-colors" onClick={pick('working')}>
            {t('svn.resolveWorking')}
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-theme-text hover:bg-theme-hover transition-colors" onClick={pick('theirs-full')}>
            {t('svn.resolveTheirs')}
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-theme-text hover:bg-theme-hover transition-colors" onClick={pick('mine-full')}>
            {t('svn.resolveMine')}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function FileRow({ file, indent, showDir, shared }: {
  file: GitStatusFile;
  indent: number;
  showDir?: boolean;
  shared: FileRowShared;
}) {
  const { t } = useI18n();
  const ch = charOf(file);
  const isActive = shared.activeFile === file.path;
  return (
    <div
      draggable
      onDragStart={(e) => shared.onDragStart(e, file)}
      onClick={() => shared.onActivate(file.path)}
      onContextMenu={(e) => shared.onContextMenu(e, file)}
      style={{ paddingLeft: 12 + indent * 14 }}
      className={`group flex items-center gap-2 pr-3 py-1.5 cursor-pointer text-xs hover:bg-warm-50/50 ${
        isActive ? 'bg-accent/10 border-l-2 border-accent' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={shared.selectedFiles.has(file.path)}
        onChange={(e) => { e.stopPropagation(); shared.onToggle(file.path); }}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      />
      <span className={`font-mono font-bold text-2xs w-3 shrink-0 ${charColor(ch)}`}>{ch}</span>
      <span className={`truncate flex-1 ${ch === 'C' ? 'text-status-error font-medium' : 'text-warm-600'}`} title={file.path}>
        {file.path.split('/').pop()}
        {showDir && file.path.includes('/') && (
          <span className="text-warm-400 ml-1 text-2xs">{file.path.substring(0, file.path.lastIndexOf('/'))}</span>
        )}
      </span>
      {ch === 'C' && (
        <ConflictResolveButton
          onResolve={(accept) => shared.onResolve(file.path, accept)}
          onOpen={() => shared.onActivate(file.path)}
        />
      )}
      <button
        onClick={(e) => shared.onContextMenu(e, file)}
        className="shrink-0 opacity-0 group-hover:opacity-100 text-warm-400 hover:text-warm-700 px-1 transition-opacity"
        title={t('svn.fileStatus')}
      >
        ⋯
      </button>
    </div>
  );
}

function DirNode({ node, depth, collapsed, onToggleCollapse, fileProps }: {
  node: DirTree;
  depth: number;
  collapsed: Set<string>;
  onToggleCollapse: (path: string) => void;
  fileProps: FileRowShared;
}) {
  const { t } = useI18n();
  const isCollapsed = collapsed.has(node.path);
  const c = countDir(node);
  const countLabel = c.dirs > 0
    ? t('svn.dirFileCount').replace('{d}', String(c.dirs)).replace('{f}', String(c.files))
    : t('svn.fileCount').replace('{f}', String(c.files));
  return (
    <>
      <div
        onClick={() => onToggleCollapse(node.path)}
        style={{ paddingLeft: 12 + depth * 14 }}
        className="flex items-center gap-1 pr-3 py-1.5 cursor-pointer text-xs hover:bg-warm-50/50 select-none"
      >
        {isCollapsed
          ? <ChevronRight className="w-3.5 h-3.5 shrink-0 text-warm-400" />
          : <ChevronDown className="w-3.5 h-3.5 shrink-0 text-warm-400" />}
        <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
        <span className="truncate text-warm-700 font-medium" title={node.path}>{node.name}</span>
        <span className="text-warm-400 text-2xs ml-1 shrink-0">{countLabel}</span>
      </div>
      {!isCollapsed && (
        <>
          {node.dirs.map((d) => (
            <DirNode key={d.path} node={d} depth={depth + 1} collapsed={collapsed} onToggleCollapse={onToggleCollapse} fileProps={fileProps} />
          ))}
          {node.files.map((f) => (
            <FileRow key={f.path} file={f} indent={depth + 1} shared={fileProps} />
          ))}
        </>
      )}
    </>
  );
}

// ── Changelist sections (IntelliJ-style) ─────────────────────────────────────

interface ClSection {
  key: string;               // stable key; '§'-prefixed in the collapsed set
  label: string;
  files: SvnFile[];
}

// Named changelists first (sorted), then the default bucket, then automatic
// status sections (unversioned '?', locally deleted '!').
function partitionSections(files: SvnFile[], t: (k: string) => string): ClSection[] {
  const named = new Map<string, SvnFile[]>();
  const def: SvnFile[] = [];
  const unversioned: SvnFile[] = [];
  const missing: SvnFile[] = [];
  for (const f of files) {
    const ch = charOf(f);
    if (f.changelist) {
      const arr = named.get(f.changelist);
      if (arr) arr.push(f); else named.set(f.changelist, [f]);
    } else if (ch === '?') unversioned.push(f);
    else if (ch === '!') missing.push(f);
    else def.push(f);
  }
  const sections: ClSection[] = Array.from(named.keys()).sort()
    .map((name) => ({ key: `cl:${name}`, label: name, files: named.get(name)! }));
  if (def.length) sections.push({ key: 'default', label: t('svn.changelistDefault'), files: def });
  if (unversioned.length) sections.push({ key: 'unversioned', label: t('svn.changelistUnversioned'), files: unversioned });
  if (missing.length) sections.push({ key: 'missing', label: t('svn.changelistMissing'), files: missing });
  return sections;
}

// ── Modifications view (LOCAL) ───────────────────────────────────────────────

function ModificationsView(props: {
  statusFiles: SvnFile[];
  statusLoading: boolean;
  remoteChecking: boolean;
  onRefresh: () => void;
  onCheckRepository: () => void;
  selectedFiles: Set<string>;
  onToggle: (path: string) => void;
  onSelectMany: (paths: string[], select: boolean) => void;
  activeFile: string | null;
  onActivate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, file: GitStatusFile) => void;
  onChangelist: (name: string | null, files: string[]) => void;
  onResolve: (path: string, accept: 'working' | 'mine-full' | 'theirs-full') => void;
  workingDiff: string;
  workingDiffLoading: boolean;
  commitMessage: string;
  onCommitMessageChange: (msg: string) => void;
  onCommit: () => void;
  busy: boolean;
  actionFlash: string | null;
  error: string | null;
}) {
  const { t } = useI18n();

  const [groupByDir, setGroupByDir] = useState<boolean>(() => {
    try { return localStorage.getItem('svn.groupByDir') !== 'false'; } catch { return true; }
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const [commitMessageHeight, setCommitMessageHeight] = useState<number>(() =>
    readStoredNumber(
      SVN_COMMIT_MESSAGE_HEIGHT_KEY,
      72,
      SVN_COMMIT_MESSAGE_MIN_HEIGHT,
      SVN_COMMIT_MESSAGE_MAX_HEIGHT,
    ),
  );
  const sections = useMemo(() => partitionSections(props.statusFiles, t), [props.statusFiles, t]);

  useEffect(() => {
    try { localStorage.setItem(SVN_COMMIT_MESSAGE_HEIGHT_KEY, String(commitMessageHeight)); } catch { /* ignore */ }
  }, [commitMessageHeight]);

  const toggleGroup = () => setGroupByDir((v) => {
    const next = !v;
    try { localStorage.setItem('svn.groupByDir', String(next)); } catch { /* ignore */ }
    return next;
  });
  const toggleCollapse = (path: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const fileProps: FileRowShared = {
    selectedFiles: props.selectedFiles,
    activeFile: props.activeFile,
    onActivate: props.onActivate,
    onToggle: props.onToggle,
    onContextMenu: props.onContextMenu,
    onDragStart: (e, file) => {
      const paths = props.selectedFiles.size > 0 && props.selectedFiles.has(file.path)
        ? props.statusFiles.filter((f) => props.selectedFiles.has(f.path)).map((f) => f.path)
        : [file.path];
      e.dataTransfer.setData('text/plain', JSON.stringify(paths));
      e.dataTransfer.effectAllowed = 'move';
    },
    onResolve: props.onResolve,
  };

  // Drop a dragged file set onto a changelist section header. Native `svn
  // changelist` only accepts versioned paths, so unversioned '?' rows are
  // filtered out; the default bucket (name=null) removes membership.
  const dropOnSection = (e: React.DragEvent, sec: ClSection) => {
    e.preventDefault();
    setDragOverKey(null);
    if (sec.key === 'unversioned' || sec.key === 'missing') return;
    let paths: string[];
    try { paths = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    const files = paths.filter((p) => {
      const f = props.statusFiles.find((x) => x.path === p);
      return f && charOf(f) !== '?';
    });
    if (files.length) props.onChangelist(sec.key.startsWith('cl:') ? sec.label : null, files);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      props.onCommit();
    }
  };

  const commitMessageMaxHeight = useCallback(() => {
    const paneHeight = leftPaneRef.current?.getBoundingClientRect().height;
    if (!paneHeight) return SVN_COMMIT_MESSAGE_MAX_HEIGHT;
    const available = paneHeight - SVN_COMMIT_FILE_LIST_MIN_HEIGHT;
    return clampNumber(available, SVN_COMMIT_MESSAGE_MIN_HEIGHT, SVN_COMMIT_MESSAGE_MAX_HEIGHT);
  }, []);

  const handleCommitMessageResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startY = e.clientY;
    const startHeight = commitMessageHeight;
    let frameId: number | null = null;
    let pendingClientY: number | null = null;

    const applyHeight = (clientY: number) => {
      const nextHeight = startHeight + (startY - clientY);
      setCommitMessageHeight(clampNumber(
        nextHeight,
        SVN_COMMIT_MESSAGE_MIN_HEIGHT,
        commitMessageMaxHeight(),
      ));
    };

    const flush = () => {
      frameId = null;
      if (pendingClientY === null) return;
      const clientY = pendingClientY;
      pendingClientY = null;
      applyHeight(clientY);
    };

    const onMove = (ev: PointerEvent) => {
      pendingClientY = ev.clientY;
      if (frameId === null) frameId = requestAnimationFrame(flush);
    };

    const onEnd = (ev: PointerEvent) => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      if (ev.type === 'pointerup' && pendingClientY !== null) flush();
      pendingClientY = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    el.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
  };

  return (
    <>
      <div className="px-3 py-2 border-b border-warm-100 flex items-center gap-2 shrink-0 flex-wrap">
        <button onClick={props.onRefresh} disabled={props.busy}
          className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
          {props.statusLoading ? t('svn.checking') : t('svn.refresh')}
        </button>
        <button onClick={props.onCheckRepository} disabled={props.busy}
          className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40 flex items-center gap-1">
          {props.remoteChecking ? t('svn.checking') : t('svn.checkRepository')}
          <span className="text-[9px] uppercase tracking-wide px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {t('svn.remoteBadge')}
          </span>
        </button>
        {props.actionFlash && <span className="text-2xs text-status-success ml-1">{props.actionFlash}</span>}
        {props.error && <span className="text-2xs text-status-error ml-1">{props.error}</span>}
      </div>

      <div className="flex-1 grid grid-cols-2 min-h-0">
        {/* Left: file list + commit area */}
        <div ref={leftPaneRef} className="border-r border-warm-100 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-warm-100 flex items-center justify-between shrink-0">
            <span className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">{t('svn.changed')}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleGroup}
                title={groupByDir ? t('svn.viewFlat') : t('svn.groupByDir')}
                className="text-warm-400 hover:text-warm-700 p-0.5 rounded hover:bg-warm-100"
              >
                {groupByDir ? <List className="w-3.5 h-3.5" /> : <FolderTree className="w-3.5 h-3.5" />}
              </button>
              <span className="text-2xs text-warm-400">{props.statusFiles.length}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {props.statusLoading ? (
              <div className="p-6 text-center text-xs text-warm-400">{t('git.loadingFiles')}</div>
            ) : props.statusFiles.length === 0 ? (
              <div className="p-6 text-center text-xs text-warm-400">{t('svn.noChanges')}</div>
            ) : (
              sections.map((sec) => {
                const secKey = `§${sec.key}`;
                const isCollapsed = collapsed.has(secKey);
                const selCount = sec.files.reduce((n, f) => n + (props.selectedFiles.has(f.path) ? 1 : 0), 0);
                const allSelected = selCount === sec.files.length;
                const tree = groupByDir ? buildDirTree(sec.files) : null;
                const droppable = sec.key !== 'unversioned' && sec.key !== 'missing';
                const isDropTarget = dragOverKey === sec.key;
                return (
                  <div key={sec.key}>
                    <div
                      onClick={() => toggleCollapse(secKey)}
                      onDragOver={droppable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverKey !== sec.key) setDragOverKey(sec.key); } : undefined}
                      onDragLeave={droppable ? () => setDragOverKey((k) => (k === sec.key ? null : k)) : undefined}
                      onDrop={droppable ? (e) => dropOnSection(e, sec) : undefined}
                      className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-xs select-none border-y border-warm-200/70 ${
                        isDropTarget ? 'bg-accent/20 ring-1 ring-inset ring-accent' : 'bg-warm-100 hover:bg-warm-200/60'
                      }`}
                    >
                      {isCollapsed
                        ? <ChevronRight className="w-3.5 h-3.5 shrink-0 text-warm-400" />
                        : <ChevronDown className="w-3.5 h-3.5 shrink-0 text-warm-400" />}
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = selCount > 0 && !allSelected; }}
                        onChange={(e) => { e.stopPropagation(); props.onSelectMany(sec.files.map((f) => f.path), !allSelected); }}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <span className="truncate text-warm-800 font-bold">{sec.label}</span>
                      <span className="text-warm-400 text-2xs ml-1 shrink-0">{sec.files.length}</span>
                    </div>
                    {!isCollapsed && (tree ? (
                      <>
                        {tree.dirs.map((d) => (
                          <DirNode key={d.path} node={d} depth={1} collapsed={collapsed} onToggleCollapse={toggleCollapse} fileProps={fileProps} />
                        ))}
                        {tree.files.map((f) => (
                          <FileRow key={f.path} file={f} indent={1} shared={fileProps} />
                        ))}
                      </>
                    ) : (
                      sec.files.map((f) => (
                        <FileRow key={f.path} file={f} indent={1} showDir shared={fileProps} />
                      ))
                    ))}
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-warm-100 shrink-0 bg-theme-bg">
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize commit message"
              onPointerDown={handleCommitMessageResizeStart}
              className="h-2 -mt-px cursor-row-resize touch-none flex items-center justify-center group"
            >
              <div className="h-px w-10 bg-warm-300 group-hover:bg-accent transition-colors" />
            </div>
            <div className="p-2 pt-1">
              <textarea
                value={props.commitMessage}
                onChange={(e) => props.onCommitMessageChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder={t('svn.commitMessagePlaceholder')}
                className="block w-full text-xs p-2 border border-warm-200 rounded resize-none focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none"
                style={{ height: commitMessageHeight }}
                rows={3}
              />
              <button
                onClick={props.onCommit}
                disabled={props.busy || !props.commitMessage.trim()}
                className="mt-2 w-full px-3 py-1.5 text-xs font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
              >
                {props.busy ? t('svn.committing') : t('svn.commit')}
              </button>
            </div>
          </div>
        </div>
        {/* Right: working diff */}
        <div className="min-w-0">
          <CommitDiffViewer diff={props.workingDiff} loading={props.workingDiffLoading} selectedFile={props.activeFile} />
        </div>
      </div>
    </>
  );
}

// ── Log view (SERVER) ─────────────────────────────────────────────────────────

function LogView(props: {
  loaded: boolean;
  entries: GitLogEntry[];
  loading: boolean;
  hasMore: boolean;
  onLoad: () => void;
  onLoadMore: () => void;
  selectedRev: string | null;
  onSelectRev: (rev: string) => void;
  revFiles: CommitFile[];
  revFilesLoading: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  revDiff: string;
  revDiffLoading: boolean;
  error: string | null;
}) {
  const { t } = useI18n();

  // Nothing is fetched until the user explicitly presses "Load log".
  if (!props.loaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-xs text-warm-400 max-w-xs">{t('svn.logEmptyHint')}</p>
        <button
          onClick={props.onLoad}
          disabled={props.loading}
          className="px-4 py-2 text-xs font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40 flex items-center gap-2"
        >
          {props.loading ? t('svn.checking') : t('svn.loadLog')}
          <span className="text-[9px] uppercase tracking-wide px-1 rounded bg-white/20">{t('svn.remoteBadge')}</span>
        </button>
        {props.error && <span className="text-2xs text-status-error">{props.error}</span>}
      </div>
    );
  }

  return (
    <>
      <div className="px-3 py-2 border-b border-warm-100 flex items-center gap-2 shrink-0">
        <button onClick={props.onLoad} disabled={props.loading}
          className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
          {props.loading ? t('svn.checking') : t('svn.refresh')}
        </button>
        {props.error && <span className="text-2xs text-status-error ml-1">{props.error}</span>}
      </div>
      <div className="flex-1 grid grid-cols-[1fr_1fr] min-h-0">
        {/* Log list */}
        <div className="border-r border-warm-100 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-warm-100 shrink-0">
            <span className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">{t('svn.history')}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {props.entries.map((e) => (
              <div
                key={e.hash}
                onClick={() => props.onSelectRev(e.hash)}
                className={`px-3 py-2 cursor-pointer text-xs border-b border-warm-50 hover:bg-warm-50/50 ${
                  props.selectedRev === e.hash ? 'bg-accent/10 border-l-2 border-accent' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-2xs text-warm-400 shrink-0">r{e.hash}</span>
                  <span className="truncate flex-1 text-warm-700" title={e.message}>{e.message.split('\n')[0]}</span>
                </div>
                <div className="mt-0.5 text-2xs text-warm-400 truncate">
                  {e.author}
                  {e.date && <span> · {new Date(e.date).toLocaleString()}</span>}
                </div>
              </div>
            ))}
            {props.hasMore && !props.loading && (
              <button onClick={props.onLoadMore} className="w-full py-2 text-2xs text-warm-500 hover:bg-warm-50">
                + {t('svn.loadMore')}
              </button>
            )}
          </div>
        </div>
        {/* Detail (file list + diff) */}
        <div className="grid grid-rows-[1fr_2fr] min-h-0">
          <div className="border-b border-warm-100 min-h-0">
            <CommitFileList
              files={props.revFiles}
              loading={props.revFilesLoading}
              selectedFile={props.selectedFile}
              onFileClick={props.onSelectFile}
              commitHash={props.selectedRev ?? undefined}
            />
          </div>
          <div className="min-h-0">
            <CommitDiffViewer diff={props.revDiff} loading={props.revDiffLoading} selectedFile={props.selectedFile} />
          </div>
        </div>
      </div>
    </>
  );
}

// ── File row context menu ─────────────────────────────────────────────────────

function FileContextMenu(props: {
  x: number;
  y: number;
  file: SvnFile;
  allFiles: SvnFile[];
  selected: Set<string>;
  onClose: () => void;
  onAdd: (files: string[]) => void;
  onRevert: (files: string[]) => void;
  onDelete: (files: string[]) => void;
  onResolve: (files: string[], accept: 'working' | 'mine-full' | 'theirs-full' | 'base') => void;
  changelists: string[];
  onChangelist: (name: string | null, files: string[]) => void;
  onNewChangelist: (files: string[]) => void;
  onViewDiff: (path: string) => void;
  onProperties: (path: string) => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.x, y: props.y });

  // Target = the selected set if this row is part of it, otherwise just this row.
  const targets = useMemo(() => {
    if (props.selected.size > 0 && props.selected.has(props.file.path)) {
      return props.allFiles.filter((f) => props.selected.has(f.path));
    }
    return [props.file];
  }, [props.selected, props.allFiles, props.file]);

  const addable = targets.filter((f) => charOf(f) === '?').map((f) => f.path);
  const revertable = targets.filter((f) => charOf(f) !== '?').map((f) => f.path);
  const deletable = targets.filter((f) => !['?', 'D'].includes(charOf(f))).map((f) => f.path);
  const resolvable = targets.filter((f) => charOf(f) === 'C').map((f) => f.path);
  // Native changelists only take versioned paths — unversioned '?' is excluded.
  const clable = targets.filter((f) => charOf(f) !== '?').map((f) => f.path);
  const inChangelist = targets.filter((f) => f.changelist).map((f) => f.path);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) props.onClose();
    };
    const onScroll = () => props.onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('scroll', onScroll, true); };
  }, [props]);

  // Clamp into viewport.
  useEffect(() => {
    if (!menuRef.current) return;
    const r = menuRef.current.getBoundingClientRect();
    let { x, y } = { x: props.x, y: props.y };
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8;
    setPos({ x, y });
  }, [props.x, props.y]);

  const count = targets.length;
  const suffix = count > 1 ? ` (${count})` : '';

  const Item = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button
      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-theme-hover transition-colors ${danger ? 'text-status-error' : 'text-theme-text'}`}
      onClick={() => { onClick(); props.onClose(); }}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-tooltip bg-theme-card border border-warm-200 dark:border-warm-700 rounded-lg shadow-elevated py-1 min-w-[200px]"
      style={{ left: pos.x, top: pos.y }}
    >
      <Item label={t('svn.viewDiff')} onClick={() => props.onViewDiff(props.file.path)} />
      {charOf(props.file) !== '?' && (
        <Item label={t('svn.properties')} onClick={() => props.onProperties(props.file.path)} />
      )}
      {addable.length > 0 && <Item label={`${t('svn.add')}${suffix}`} onClick={() => props.onAdd(addable)} />}
      {revertable.length > 0 && <Item label={`${t('svn.revert')}${suffix}`} onClick={() => props.onRevert(revertable)} />}
      {deletable.length > 0 && <Item label={`${t('svn.delete')}${suffix}`} danger onClick={() => props.onDelete(deletable)} />}
      {resolvable.length > 0 && (
        <>
          <div className="border-t border-warm-100 dark:border-warm-700 my-1" />
          <div className="px-3 py-1 text-[10px] font-semibold text-warm-400 uppercase tracking-wider">{t('svn.resolve')}</div>
          <Item label={t('svn.resolveWorking')} onClick={() => props.onResolve(resolvable, 'working')} />
          <Item label={t('svn.resolveMine')} onClick={() => props.onResolve(resolvable, 'mine-full')} />
          <Item label={t('svn.resolveTheirs')} onClick={() => props.onResolve(resolvable, 'theirs-full')} />
          <Item label={t('svn.resolveBase')} onClick={() => props.onResolve(resolvable, 'base')} />
        </>
      )}
      {clable.length > 0 && (
        <>
          <div className="border-t border-warm-100 dark:border-warm-700 my-1" />
          <div className="px-3 py-1 text-[10px] font-semibold text-warm-400 uppercase tracking-wider">{t('svn.moveToChangelist')}</div>
          {props.changelists.map((name) => (
            <Item key={name} label={`${name}${suffix}`} onClick={() => props.onChangelist(name, clable)} />
          ))}
          <Item label={t('svn.newChangelist')} onClick={() => props.onNewChangelist(clable)} />
          {inChangelist.length > 0 && (
            <Item label={`${t('svn.removeFromChangelist')}${suffix}`} onClick={() => props.onChangelist(null, inChangelist)} />
          )}
        </>
      )}
    </div>,
    document.body
  );
}

// ── Properties dialog (LOCAL: `svn proplist -v`) ──────────────────────────────

function PropertiesDialog({ projectId, file, onClose }: {
  projectId: string;
  file: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [props, setProps] = useState<svnApi.SvnProperty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // property name being edited
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProps(null);
    setError(null);
    svnApi.getSvnProperties(projectId, file ?? undefined)
      .then((r) => { if (!cancelled) setProps(r.properties); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load properties'); });
    return () => { cancelled = true; };
  }, [projectId, file, reloadKey]);

  const save = async (name: string) => {
    setSaving(true);
    setError(null);
    try {
      await svnApi.svnPropset(projectId, name, draft, file ?? undefined);
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save property');
    } finally {
      setSaving(false);
    }
  };

  const target = file ?? t('svn.workingCopyRoot');

  return (
    <Modal open onClose={onClose} size="2xl">
      <div className="bg-theme-card rounded-lg shadow-xl w-full max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-warm-100 flex items-center justify-between shrink-0">
          <span className="text-sm font-semibold text-warm-700 truncate" title={target}>
            {t('svn.propertiesOf').replace('{target}', target)}
          </span>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600 shrink-0 ml-2">✕</button>
        </div>
        <div className="p-4 overflow-y-auto">
          {error && (
            <p className="text-status-error text-xs mb-2 whitespace-pre-wrap break-all">{error}</p>
          )}
          {props === null ? (
            !error && <p className="text-warm-400 text-xs">{t('git.loadingFiles')}</p>
          ) : props.length === 0 ? (
            <p className="text-warm-400 text-xs">{t('svn.noProperties')}</p>
          ) : (
            <div className="space-y-3">
              {props.map((p) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-mono font-semibold text-accent break-all">{p.name}</div>
                    {editing !== p.name && (
                      <button
                        onClick={() => { setEditing(p.name); setDraft(p.value); }}
                        className="text-2xs text-warm-400 hover:text-accent shrink-0"
                      >
                        {t('svn.editProperty')}
                      </button>
                    )}
                  </div>
                  {editing === p.name ? (
                    <>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
                        spellCheck={false}
                        className="mt-1 w-full text-2xs font-mono text-warm-700 bg-warm-50 dark:bg-warm-800/40 rounded p-2 border border-accent/40 focus:outline-none focus:border-accent resize-y"
                      />
                      <div className="mt-1 flex justify-end gap-2">
                        <button
                          onClick={() => setEditing(null)}
                          disabled={saving}
                          className="px-2.5 py-1 text-2xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40"
                        >
                          {t('svn.cancel')}
                        </button>
                        <button
                          onClick={() => save(p.name)}
                          disabled={saving}
                          className="px-2.5 py-1 text-2xs font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
                        >
                          {t('svn.saveProperty')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <pre className="mt-1 text-2xs font-mono text-warm-600 bg-warm-50 dark:bg-warm-800/40 rounded p-2 whitespace-pre-wrap break-all">
                      {p.value || '—'}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-warm-100 shrink-0 text-right">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-warm-200 hover:bg-warm-50">
            {t('svn.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
