import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import * as svnApi from '../api/svn';
import type { SvnStatusResult } from '../api/svn';
import type { CommitFile, GitLogEntry, GitStatusFile } from '../api/projects';
import { getCliStatus } from '../api/cli-status';
import { useI18n } from '../i18n';
import { CommitDiffViewer, CommitFileList } from './DiffViewer';

interface SvnStatusPanelProps {
  project: Project;
  refreshTrigger?: number;
}

type WorkspaceView = 'files' | 'history';

const VIEW_KEY = (id: string) => `svn-workspace:${id}`;

export default function SvnStatusPanel({ project, refreshTrigger }: SvnStatusPanelProps) {
  const { t } = useI18n();

  const [view, setView] = useState<WorkspaceView>(() => {
    const stored = localStorage.getItem(VIEW_KEY(project.id));
    return stored === 'history' ? 'history' : 'files';
  });
  useEffect(() => {
    localStorage.setItem(VIEW_KEY(project.id), view);
  }, [view, project.id]);

  // Common error/loading state
  const [error, setError] = useState<string | null>(null);
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

  // ── File Status state ───────────────────────────────────────────────────
  const [status, setStatus] = useState<SvnStatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [workingDiff, setWorkingDiff] = useState<string>('');
  const [workingDiffLoading, setWorkingDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFlash, setActionFlash] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const s = await svnApi.getSvnStatus(project.id);
      setStatus(s);
      // Drop stale selections that no longer exist
      setSelectedFiles((prev) => {
        const valid = new Set(s.files.map((f) => f.path));
        const next = new Set<string>();
        prev.forEach((p) => valid.has(p) && next.add(p));
        return next;
      });
      if (activeFile && !s.files.some((f) => f.path === activeFile)) {
        setActiveFile(null);
        setWorkingDiff('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SVN status');
    } finally {
      setStatusLoading(false);
    }
  }, [project.id, activeFile]);

  useEffect(() => {
    if (view === 'files') refreshStatus();
  }, [view, refreshStatus, refreshTrigger]);

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

  const requireSelection = (): string[] | null => {
    if (selectedFiles.size === 0) {
      setError(t('svn.selectFiles'));
      return null;
    }
    return Array.from(selectedFiles);
  };

  const handleAdd = () => {
    const files = requireSelection(); if (!files) return;
    runAction(() => svnApi.svnAdd(project.id, files));
  };
  const handleRevert = () => {
    const files = requireSelection(); if (!files) return;
    runAction(() => svnApi.svnRevert(project.id, files));
  };
  const handleDelete = () => {
    const files = requireSelection(); if (!files) return;
    runAction(() => svnApi.svnDelete(project.id, files));
  };
  const handleResolve = () => {
    const files = requireSelection(); if (!files) return;
    runAction(() => svnApi.svnResolve(project.id, files, 'working'));
  };
  const handleUpdate = () => {
    runAction(async () => {
      const r = await svnApi.svnUpdate(project.id);
      setActionFlash(r.revision ? t('svn.updateSuccess').replace('{rev}', r.revision) : t('svn.update'));
    });
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

  // ── History state ───────────────────────────────────────────────────────
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
      setLogEntries((prev) => skip === 0 ? r.commits : [...prev, ...r.commits]);
      setLogHasMore(r.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log failed');
    } finally {
      setLogLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (view === 'history' && logEntries.length === 0) loadLog(0);
  }, [view, logEntries.length, loadLog]);

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
    svnApi.getSvnCommitDiff(project.id, selectedRev, revSelectedFile)
      .then((r) => { if (!cancelled) setRevDiff(r.diff); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Diff failed'); })
      .finally(() => { if (!cancelled) setRevDiffLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, selectedRev, revSelectedFile]);

  // ── Render ──────────────────────────────────────────────────────────────
  const repoLine = useMemo(() => {
    if (!status) return null;
    const parts: string[] = [];
    if (status.branch) parts.push(status.branch);
    if (status.revision) parts.push(`r${status.revision}`);
    return parts.join('  ·  ');
  }, [status]);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '600px' }}>
      {svnInstalled === false && (
        <div className="px-3 py-2 bg-status-warning/10 border-b border-status-warning/30 text-2xs text-status-warning">
          {t('svn.cliMissing')}
        </div>
      )}
      <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <div className="w-44 shrink-0 border-r border-warm-100 bg-warm-50/30 flex flex-col">
        <div className="px-3 py-3 border-b border-warm-100">
          <div className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">SVN</div>
          {repoLine && (
            <div className="mt-1 text-2xs text-warm-400 truncate" title={status?.tracking ?? undefined}>
              {repoLine}
            </div>
          )}
        </div>
        <button
          onClick={() => setView('files')}
          className={`text-left px-3 py-2 text-xs transition-colors ${
            view === 'files' ? 'bg-accent/10 text-accent font-semibold border-l-2 border-accent' : 'text-warm-600 hover:bg-warm-50'
          }`}
        >
          {t('svn.fileStatus')}
        </button>
        <button
          onClick={() => setView('history')}
          className={`text-left px-3 py-2 text-xs transition-colors ${
            view === 'history' ? 'bg-accent/10 text-accent font-semibold border-l-2 border-accent' : 'text-warm-600 hover:bg-warm-50'
          }`}
        >
          {t('svn.history')}
        </button>
        <div className="flex-1" />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Action bar */}
        <div className="px-3 py-2 border-b border-warm-100 flex items-center gap-2 shrink-0 flex-wrap">
          {view === 'files' ? (
            <>
              <button onClick={refreshStatus} disabled={actionBusy || statusLoading}
                className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
                {t('svn.refresh')}
              </button>
              <button onClick={handleUpdate} disabled={actionBusy}
                className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
                {t('svn.update')}
              </button>
              <span className="w-px h-4 bg-warm-200 mx-1" />
              <button onClick={handleAdd} disabled={actionBusy || selectedFiles.size === 0}
                className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
                {t('svn.add')}
              </button>
              <button onClick={handleRevert} disabled={actionBusy || selectedFiles.size === 0}
                className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
                {t('svn.revert')}
              </button>
              <button onClick={handleDelete} disabled={actionBusy || selectedFiles.size === 0}
                className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
                {t('svn.delete')}
              </button>
              <button onClick={handleResolve} disabled={actionBusy || selectedFiles.size === 0}
                className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
                {t('svn.resolve')}
              </button>
            </>
          ) : (
            <button onClick={() => loadLog(0)} disabled={logLoading}
              className="px-2 py-1 text-xs rounded border border-warm-200 hover:bg-warm-50 disabled:opacity-40">
              {t('svn.refresh')}
            </button>
          )}
          {actionFlash && <span className="text-2xs text-status-success ml-2">{actionFlash}</span>}
          {error && <span className="text-2xs text-status-error ml-2">{error}</span>}
        </div>

        {view === 'files' ? (
          <FileStatusView
            statusFiles={status?.files ?? []}
            statusLoading={statusLoading}
            selectedFiles={selectedFiles}
            onToggle={toggleFile}
            activeFile={activeFile}
            onActivate={setActiveFile}
            workingDiff={workingDiff}
            workingDiffLoading={workingDiffLoading}
            commitMessage={commitMessage}
            onCommitMessageChange={setCommitMessage}
            onCommit={handleCommit}
            commitBusy={actionBusy}
          />
        ) : (
          <HistoryView
            entries={logEntries}
            loading={logLoading}
            hasMore={logHasMore}
            onLoadMore={() => loadLog(logEntries.length)}
            selectedRev={selectedRev}
            onSelectRev={selectRevision}
            revFiles={revFiles}
            revFilesLoading={revFilesLoading}
            selectedFile={revSelectedFile}
            onSelectFile={setRevSelectedFile}
            revDiff={revDiff}
            revDiffLoading={revDiffLoading}
          />
        )}
      </div>
      </div>
    </div>
  );
}

// ── File Status view ──────────────────────────────────────────────────────

function FileStatusView(props: {
  statusFiles: GitStatusFile[];
  statusLoading: boolean;
  selectedFiles: Set<string>;
  onToggle: (path: string) => void;
  activeFile: string | null;
  onActivate: (path: string) => void;
  workingDiff: string;
  workingDiffLoading: boolean;
  commitMessage: string;
  onCommitMessageChange: (msg: string) => void;
  onCommit: () => void;
  commitBusy: boolean;
}) {
  const { t } = useI18n();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      props.onCommit();
    }
  };

  return (
    <div className="flex-1 grid grid-cols-2 min-h-0">
      {/* Left: file list + commit area */}
      <div className="border-r border-warm-100 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-warm-100 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">
            {t('svn.changed')}
          </span>
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
              const ch = f.working_dir.trim() || '?';
              const color = ch === 'A' ? 'text-status-success'
                : ch === 'D' ? 'text-status-error'
                : ch === 'M' ? 'text-accent'
                : ch === 'U' ? 'text-purple-500'
                : ch === '?' ? 'text-warm-400'
                : 'text-amber-500';
              return (
                <div
                  key={f.path}
                  onClick={() => props.onActivate(f.path)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-warm-50/50 ${
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
                  <span className={`font-mono font-bold text-2xs w-3 shrink-0 ${color}`}>{ch}</span>
                  <span className="truncate flex-1 text-warm-600" title={f.path}>
                    {f.path.split('/').pop()}
                    <span className="text-warm-400 ml-1 text-2xs">
                      {f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : ''}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t border-warm-100 p-2 shrink-0">
          <textarea
            ref={taRef}
            value={props.commitMessage}
            onChange={(e) => props.onCommitMessageChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('svn.commitMessagePlaceholder')}
            className="w-full text-xs p-2 border border-warm-200 rounded resize-y min-h-[60px] focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none"
            rows={3}
          />
          <button
            onClick={props.onCommit}
            disabled={props.commitBusy || !props.commitMessage.trim()}
            className="mt-2 w-full px-3 py-1.5 text-xs font-semibold rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
          >
            {props.commitBusy ? t('svn.committing') : t('svn.commit')}
          </button>
        </div>
      </div>
      {/* Right: working diff */}
      <div className="min-w-0">
        <CommitDiffViewer
          diff={props.workingDiff}
          loading={props.workingDiffLoading}
          selectedFile={props.activeFile}
        />
      </div>
    </div>
  );
}

// ── History view ──────────────────────────────────────────────────────────

function HistoryView(props: {
  entries: GitLogEntry[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedRev: string | null;
  onSelectRev: (rev: string) => void;
  revFiles: CommitFile[];
  revFilesLoading: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  revDiff: string;
  revDiffLoading: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="flex-1 grid grid-cols-[1fr_1fr] min-h-0">
      {/* Log list */}
      <div className="border-r border-warm-100 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-warm-100 shrink-0">
          <span className="text-[11px] font-semibold text-warm-500 uppercase tracking-wider">
            {t('svn.history')}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {props.entries.length === 0 && props.loading && (
            <div className="p-6 text-center text-xs text-warm-400">{t('git.loadingFiles')}</div>
          )}
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
            <button onClick={props.onLoadMore}
              className="w-full py-2 text-2xs text-warm-500 hover:bg-warm-50">
              + {t('svn.refresh')}
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
          <CommitDiffViewer
            diff={props.revDiff}
            loading={props.revDiffLoading}
            selectedFile={props.selectedFile}
          />
        </div>
      </div>
    </div>
  );
}
