import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../types';
import * as svnApi from '../api/svn';
import type { SvnStatusResult } from '../api/svn';
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
    : ch === 'U' ? 'text-purple-500'
    : ch === '?' ? 'text-warm-400'
    : 'text-amber-500';

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

  // ── Global commands ───────────────────────────────────────────────────────
  const handleUpdate = () =>
    runAction(async () => {
      const r = await svnApi.svnUpdate(project.id);
      setActionFlash(r.revision ? t('svn.updateSuccess').replace('{rev}', r.revision) : t('svn.update'));
    });

  const [showRevDialog, setShowRevDialog] = useState(false);
  const [revInput, setRevInput] = useState('');
  const handleUpdateToRevision = () => {
    const rev = revInput.trim();
    if (!rev) return;
    setShowRevDialog(false);
    runAction(async () => {
      const r = await svnApi.svnUpdate(project.id, rev);
      setActionFlash(r.revision ? t('svn.updateSuccess').replace('{rev}', r.revision) : t('svn.update'));
      setRevInput('');
    });
  };

  const handleCleanup = () =>
    runAction(() => svnApi.svnCleanup(project.id), t('svn.cleanupSuccess'));

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

  const repoLine = useMemo(() => {
    if (!status) return null;
    const parts: string[] = [];
    if (status.branch) parts.push(status.branch);
    if (status.revision) parts.push(`r${status.revision}`);
    return parts.join('  ·  ');
  }, [status]);

  const busy = actionBusy || statusLoading || remoteChecking;

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}>
      {svnInstalled === false && (
        <div className="card mb-2 px-3 py-2 bg-status-warning/10 border border-status-warning/30 text-2xs text-status-warning">
          {t('svn.cliMissing')}
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
              activeFile={activeFile}
              onActivate={setActiveFile}
              onContextMenu={openCtxMenu}
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

// ── Modifications view (LOCAL) ───────────────────────────────────────────────

function ModificationsView(props: {
  statusFiles: GitStatusFile[];
  statusLoading: boolean;
  remoteChecking: boolean;
  onRefresh: () => void;
  onCheckRepository: () => void;
  selectedFiles: Set<string>;
  onToggle: (path: string) => void;
  activeFile: string | null;
  onActivate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, file: GitStatusFile) => void;
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

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      props.onCommit();
    }
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
        <div className="border-r border-warm-100 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-warm-100 flex items-center justify-between shrink-0">
            <span className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">{t('svn.changed')}</span>
            <span className="text-2xs text-warm-400">{props.statusFiles.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {props.statusLoading ? (
              <div className="p-6 text-center text-xs text-warm-400">{t('git.loadingFiles')}</div>
            ) : props.statusFiles.length === 0 ? (
              <div className="p-6 text-center text-xs text-warm-400">{t('svn.noChanges')}</div>
            ) : (
              props.statusFiles.map((f) => {
                const checked = props.selectedFiles.has(f.path);
                const isActive = props.activeFile === f.path;
                const ch = charOf(f);
                return (
                  <div
                    key={f.path}
                    onClick={() => props.onActivate(f.path)}
                    onContextMenu={(e) => props.onContextMenu(e, f)}
                    className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-warm-50/50 ${
                      isActive ? 'bg-accent/10 border-l-2 border-accent' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => { e.stopPropagation(); props.onToggle(f.path); }}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />
                    <span className={`font-mono font-bold text-2xs w-3 shrink-0 ${charColor(ch)}`}>{ch}</span>
                    <span className="truncate flex-1 text-warm-600" title={f.path}>
                      {f.path.split('/').pop()}
                      <span className="text-warm-400 ml-1 text-2xs">
                        {f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : ''}
                      </span>
                    </span>
                    <button
                      onClick={(e) => props.onContextMenu(e, f)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-warm-400 hover:text-warm-700 px-1 transition-opacity"
                      title={t('svn.fileStatus')}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-warm-100 p-2 shrink-0">
            <textarea
              value={props.commitMessage}
              onChange={(e) => props.onCommitMessageChange(e.target.value)}
              onKeyDown={handleKey}
              placeholder={t('svn.commitMessagePlaceholder')}
              className="w-full text-xs p-2 border border-warm-200 rounded resize-y min-h-[60px] focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none"
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
  file: GitStatusFile;
  allFiles: GitStatusFile[];
  selected: Set<string>;
  onClose: () => void;
  onAdd: (files: string[]) => void;
  onRevert: (files: string[]) => void;
  onDelete: (files: string[]) => void;
  onResolve: (files: string[], accept: 'working' | 'mine-full' | 'theirs-full' | 'base') => void;
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
  const resolvable = targets.filter((f) => charOf(f) === 'U').map((f) => f.path);

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
      className="fixed z-sticky bg-theme-card border border-warm-200 dark:border-warm-700 rounded-lg shadow-xl py-1 min-w-[200px]"
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

  useEffect(() => {
    let cancelled = false;
    setProps(null);
    setError(null);
    svnApi.getSvnProperties(projectId, file ?? undefined)
      .then((r) => { if (!cancelled) setProps(r.properties); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load properties'); });
    return () => { cancelled = true; };
  }, [projectId, file]);

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
          {error ? (
            <p className="text-status-error text-xs">{error}</p>
          ) : props === null ? (
            <p className="text-warm-400 text-xs">{t('git.loadingFiles')}</p>
          ) : props.length === 0 ? (
            <p className="text-warm-400 text-xs">{t('svn.noProperties')}</p>
          ) : (
            <div className="space-y-3">
              {props.map((p) => (
                <div key={p.name}>
                  <div className="text-xs font-mono font-semibold text-accent break-all">{p.name}</div>
                  <pre className="mt-1 text-2xs font-mono text-warm-600 bg-warm-50 dark:bg-warm-800/40 rounded p-2 whitespace-pre-wrap break-all">
                    {p.value || '—'}
                  </pre>
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
