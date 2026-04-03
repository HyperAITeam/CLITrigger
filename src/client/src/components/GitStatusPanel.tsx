import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import type { GitLogEntry, GitRef, GitStatusFile } from '../api/projects';
import { useI18n } from '../i18n';

interface GitStatusPanelProps {
  project: Project;
}

// --- Lane assignment algorithm ---

const LANE_COLORS = [
  '#D4A843', // gold
  '#2196F3', // blue
  '#4CAF50', // green
  '#E53935', // red
  '#9C27B0', // purple
  '#FF9800', // orange
  '#00BCD4', // cyan
  '#795548', // brown
];

interface GraphNode {
  lane: number;
  color: string;
  connections: Array<{
    fromLane: number;
    toLane: number;
    toRow: number;
    color: string;
  }>;
}

function computeGraphLanes(commits: GitLogEntry[]): GraphNode[] {
  const hashToRow = new Map<string, number>();
  commits.forEach((c, i) => hashToRow.set(c.hash, i));

  const activeLanes: (string | null)[] = [];
  const result: GraphNode[] = [];

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];

    let lane = activeLanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = activeLanes.indexOf(null);
      if (lane === -1) {
        lane = activeLanes.length;
        activeLanes.push(null);
      }
    }
    activeLanes[lane] = null;

    const color = LANE_COLORS[lane % LANE_COLORS.length];
    const connections: GraphNode['connections'] = [];

    for (let pi = 0; pi < commit.parentHashes.length; pi++) {
      const parentHash = commit.parentHashes[pi];
      const parentRow = hashToRow.get(parentHash);
      if (parentRow === undefined) continue;

      let parentLane = activeLanes.indexOf(parentHash);
      if (parentLane !== -1) {
        connections.push({
          fromLane: lane,
          toLane: parentLane,
          toRow: parentRow,
          color: LANE_COLORS[parentLane % LANE_COLORS.length],
        });
      } else {
        if (pi === 0) {
          activeLanes[lane] = parentHash;
          connections.push({ fromLane: lane, toLane: lane, toRow: parentRow, color });
        } else {
          let newLane = activeLanes.indexOf(null);
          if (newLane === -1) {
            newLane = activeLanes.length;
            activeLanes.push(null);
          }
          activeLanes[newLane] = parentHash;
          connections.push({
            fromLane: lane,
            toLane: newLane,
            toRow: parentRow,
            color: LANE_COLORS[newLane % LANE_COLORS.length],
          });
        }
      }
    }

    result.push({ lane, color, connections });
  }

  return result;
}

// --- Ref badge ---

function RefBadge({ refStr }: { refStr: string }) {
  const isHead = refStr.startsWith('HEAD');
  const isRemote = refStr.startsWith('origin/') || refStr.includes('remotes/');
  const isTag = refStr.startsWith('tag: ');

  let label = refStr;
  let classes = '';

  if (isTag) {
    label = refStr.replace('tag: ', '');
    classes = 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
  } else if (isHead) {
    label = refStr.replace('HEAD -> ', '');
    classes = 'bg-status-success/15 text-status-success font-semibold';
  } else if (isRemote) {
    classes = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  } else {
    classes = 'bg-accent-gold/15 text-accent-gold';
  }

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}

// --- Graph SVG ---

const ROW_HEIGHT = 32;
const LANE_WIDTH = 16;
const DOT_RADIUS = 4;
const MAX_LANES = 10;

function CommitGraphSvg({ graphNodes, totalRows }: { graphNodes: GraphNode[]; totalRows: number }) {
  const maxLane = Math.min(
    MAX_LANES,
    graphNodes.reduce((max, n) => {
      const connMax = n.connections.reduce((cm, c) => Math.max(cm, c.fromLane, c.toLane), 0);
      return Math.max(max, n.lane, connMax);
    }, 0) + 1
  );
  const width = (maxLane + 1) * LANE_WIDTH + 8;

  return (
    <svg
      width={width}
      height={totalRows * ROW_HEIGHT}
      className="shrink-0"
      style={{ minWidth: width }}
    >
      {graphNodes.map((node, row) =>
        node.connections.map((conn, ci) => {
          const x1 = conn.fromLane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
          const y1 = row * ROW_HEIGHT + ROW_HEIGHT / 2;
          const x2 = conn.toLane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
          const y2 = conn.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

          if (x1 === x2) {
            return (
              <line
                key={`${row}-${ci}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={conn.color} strokeWidth={2} strokeOpacity={0.7}
              />
            );
          } else {
            const midY = (y1 + y2) / 2;
            return (
              <path
                key={`${row}-${ci}`}
                d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
                fill="none" stroke={conn.color} strokeWidth={2} strokeOpacity={0.7}
              />
            );
          }
        })
      )}
      {graphNodes.map((node, row) => {
        const cx = node.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
        const cy = row * ROW_HEIGHT + ROW_HEIGHT / 2;
        return (
          <circle
            key={`dot-${row}`}
            cx={cx} cy={cy} r={DOT_RADIUS}
            fill={node.color} stroke="white" strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

// --- File status icon ---

function fileStatusLabel(index: string, workingDir: string): { label: string; color: string } {
  if (index === '?' || workingDir === '?') return { label: 'U', color: 'text-warm-400' };
  if (index === 'A' || workingDir === 'A') return { label: 'A', color: 'text-status-success' };
  if (index === 'D' || workingDir === 'D') return { label: 'D', color: 'text-status-error' };
  if (index === 'R' || workingDir === 'R') return { label: 'R', color: 'text-purple-500' };
  if (index === 'C' || workingDir === 'C') return { label: 'C', color: 'text-blue-500' };
  return { label: 'M', color: 'text-accent-gold' };
}

// --- Action Toolbar ---

function ActionToolbar({
  projectId,
  onRefresh,
  busy,
  setBusy,
  branches,
  statusFiles,
}: {
  projectId: string;
  onRefresh: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  branches: GitRef[];
  statusFiles: GitStatusFile[];
}) {
  const { t } = useI18n();
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [inputValue2, setInputValue2] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const closeModal = () => { setActiveModal(null); setInputValue(''); setInputValue2(''); setActionError(null); };

  const exec = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      closeModal();
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const hasStagedFiles = statusFiles.some(f => f.index !== ' ' && f.index !== '?');

  const ToolbarBtn = ({ label, onClick, icon, badge }: { label: string; onClick: () => void; icon: React.ReactNode; badge?: number }) => (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded hover:bg-warm-50 transition-colors disabled:opacity-50 relative"
      title={label}
    >
      <div className="h-5 w-5 flex items-center justify-center text-warm-500">{icon}</div>
      <span className="text-[10px] text-warm-600 whitespace-nowrap">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-accent-gold text-white text-[9px] font-bold rounded-full h-3.5 min-w-[14px] flex items-center justify-center px-0.5">
          {badge}
        </span>
      )}
    </button>
  );

  const Modal = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeModal}>
      <div className="bg-white rounded-lg shadow-xl w-80 max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-warm-100">
          <span className="text-sm font-semibold text-warm-700">{title}</span>
          <button onClick={closeModal} className="text-warm-400 hover:text-warm-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-3">
          {actionError && <p className="text-status-error text-xs">{actionError}</p>}
          {children}
        </div>
      </div>
    </div>
  );

  const localBranches = branches.filter(b => !b.remote);

  return (
    <>
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-warm-100 overflow-x-auto">
        <ToolbarBtn label={t('git.commit')} onClick={() => setActiveModal('commit')} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        } />
        <ToolbarBtn label={t('git.pull')} onClick={() => exec(() => projectsApi.gitPull(projectId))} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        } />
        <ToolbarBtn label={t('git.push')} onClick={() => exec(() => projectsApi.gitPush(projectId))} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        } />
        <ToolbarBtn label={t('git.fetch')} onClick={() => exec(() => projectsApi.gitFetch(projectId))} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 7.5h-.75A2.25 2.25 0 004.5 9.75v7.5a2.25 2.25 0 002.25 2.25h7.5a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25h-.75m-6 3.75l3 3m0 0l3-3m-3 3V1.5" />
          </svg>
        } />

        <div className="w-px h-8 bg-warm-200 mx-1" />

        <ToolbarBtn label={t('git.branch')} onClick={() => setActiveModal('branch')} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v12m0 0a3 3 0 103 3H15a3 3 0 100-3m-9 0h9m-9 0a3 3 0 01-3-3V6a3 3 0 013-3h0" />
          </svg>
        } />
        <ToolbarBtn label={t('git.merge')} onClick={() => setActiveModal('merge')} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        } />
        <ToolbarBtn label={t('git.stash')} onClick={() => setActiveModal('stash')} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        } />
        <ToolbarBtn label={t('git.discard')} onClick={() => {
          if (statusFiles.length === 0) return;
          if (confirm(t('git.confirmDiscard'))) {
            exec(() => projectsApi.gitDiscard(projectId, undefined, true));
          }
        }} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
        } />
        <ToolbarBtn label={t('git.tag')} onClick={() => setActiveModal('tag')} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
          </svg>
        } />
      </div>

      {/* Modals */}
      {activeModal === 'commit' && (
        <Modal title={t('git.commit')}>
          <textarea
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent-gold"
            rows={3}
            placeholder={t('git.commitMessage')}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            autoFocus
          />
          <button
            className="w-full btn-primary text-sm py-2"
            disabled={busy || !inputValue.trim() || !hasStagedFiles}
            onClick={() => exec(() => projectsApi.gitCommit(projectId, inputValue.trim()))}
          >
            {t('git.commit')} {!hasStagedFiles && <span className="text-xs opacity-70 ml-1">({t('git.staged')}: 0)</span>}
          </button>
        </Modal>
      )}

      {activeModal === 'branch' && (
        <Modal title={t('git.newBranch')}>
          <input
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent-gold"
            placeholder={t('git.branchName')}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              className="flex-1 btn-primary text-sm py-2"
              disabled={busy || !inputValue.trim()}
              onClick={() => exec(() => projectsApi.gitCreateBranch(projectId, inputValue.trim()))}
            >
              {t('git.create')}
            </button>
          </div>
          {localBranches.length > 0 && (
            <div className="border-t border-warm-100 pt-2 mt-1">
              <p className="text-[10px] text-warm-400 uppercase tracking-wider mb-1">{t('git.selectBranch')}</p>
              <div className="max-h-32 overflow-y-auto space-y-px">
                {localBranches.filter(b => !b.current).map(b => (
                  <div key={b.name} className="flex items-center justify-between px-2 py-1 text-xs hover:bg-warm-50 rounded group">
                    <button
                      className="truncate text-warm-600 hover:text-accent-gold"
                      onClick={() => exec(() => projectsApi.gitCheckout(projectId, b.name))}
                    >
                      {b.name}
                    </button>
                    <button
                      className="text-warm-300 hover:text-status-error opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                      onClick={() => { if (confirm(`Delete branch ${b.name}?`)) exec(() => projectsApi.gitDeleteBranch(projectId, b.name)); }}
                    >
                      {t('git.delete')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}

      {activeModal === 'merge' && (
        <Modal title={t('git.merge')}>
          <p className="text-xs text-warm-500">{t('git.selectBranch')}</p>
          <div className="max-h-48 overflow-y-auto space-y-px">
            {localBranches.filter(b => !b.current).map(b => (
              <button
                key={b.name}
                className="w-full text-left px-3 py-2 text-sm hover:bg-warm-50 rounded text-warm-600 truncate"
                disabled={busy}
                onClick={() => exec(() => projectsApi.gitMerge(projectId, b.name))}
              >
                {b.name}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {activeModal === 'stash' && (
        <StashModal projectId={projectId} busy={busy} exec={exec} inputValue={inputValue} setInputValue={setInputValue} />
      )}

      {activeModal === 'tag' && (
        <Modal title={t('git.tag')}>
          <input
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent-gold"
            placeholder={t('git.tagName')}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            autoFocus
          />
          <input
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent-gold"
            placeholder={t('git.tagMessage')}
            value={inputValue2}
            onChange={e => setInputValue2(e.target.value)}
          />
          <button
            className="w-full btn-primary text-sm py-2"
            disabled={busy || !inputValue.trim()}
            onClick={() => exec(() => projectsApi.gitCreateTag(projectId, inputValue.trim(), inputValue2.trim() || undefined))}
          >
            {t('git.create')}
          </button>
        </Modal>
      )}
    </>
  );
}

// --- Stash Modal (needs to fetch stash list) ---

function StashModal({ projectId, busy, exec, inputValue, setInputValue }: {
  projectId: string;
  busy: boolean;
  exec: (fn: () => Promise<unknown>) => void;
  inputValue: string;
  setInputValue: (v: string) => void;
}) {
  const { t } = useI18n();
  const [stashes, setStashes] = useState<Array<{ index: number; message: string }>>([]);

  useEffect(() => {
    projectsApi.gitStashList(projectId).then(setStashes).catch(() => {});
  }, [projectId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setInputValue('')}>
      <div className="bg-white rounded-lg shadow-xl w-80 max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-warm-100">
          <span className="text-sm font-semibold text-warm-700">{t('git.stash')}</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent-gold"
              placeholder={t('git.stashMessage')}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              autoFocus
            />
            <button
              className="btn-primary text-sm px-3 py-2"
              disabled={busy}
              onClick={() => exec(() => projectsApi.gitStashPush(projectId, inputValue.trim() || undefined))}
            >
              {t('git.stash')}
            </button>
          </div>

          {stashes.length > 0 ? (
            <div className="space-y-px max-h-40 overflow-y-auto">
              {stashes.map(s => (
                <div key={s.index} className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-warm-50 rounded">
                  <span className="text-warm-600 truncate flex-1">{s.message || `stash@{${s.index}}`}</span>
                  <button
                    className="text-accent-gold hover:underline text-[11px] ml-2 shrink-0"
                    disabled={busy}
                    onClick={() => exec(() => projectsApi.gitStashPop(projectId, s.index))}
                  >
                    {t('git.stashPop')}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-warm-400 text-center">{t('git.noStashes')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- File Status Panel ---

function FileStatusSection({
  projectId,
  files,
  busy,
  setBusy,
  onRefresh,
}: {
  projectId: string;
  files: GitStatusFile[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();

  const staged = files.filter(f => f.index !== ' ' && f.index !== '?');
  const unstaged = files.filter(f => f.working_dir !== ' ' && f.working_dir !== '?' && (f.index === ' ' || f.index === '?'));
  const untracked = files.filter(f => f.index === '?' && f.working_dir === '?');

  const exec = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); onRefresh(); } catch { /* ignore */ } finally { setBusy(false); }
  };

  if (files.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-warm-400 text-center">
        {t('git.noChanges')}
      </div>
    );
  }

  const FileRow = ({ file, type }: { file: GitStatusFile; type: 'staged' | 'unstaged' | 'untracked' }) => {
    const status = type === 'staged'
      ? fileStatusLabel(file.index, ' ')
      : fileStatusLabel(' ', file.working_dir);

    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-warm-50 rounded group text-xs">
        <span className={`font-mono font-bold text-[10px] w-3 text-center ${status.color}`}>{status.label}</span>
        <span className="truncate flex-1 text-warm-600">{file.path}</span>
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
          {type === 'staged' && (
            <button
              className="text-[10px] text-warm-400 hover:text-warm-600"
              disabled={busy}
              onClick={() => exec(() => projectsApi.gitUnstage(projectId, [file.path]))}
            >{t('git.unstage')}</button>
          )}
          {type === 'unstaged' && (
            <>
              <button
                className="text-[10px] text-accent-gold hover:underline"
                disabled={busy}
                onClick={() => exec(() => projectsApi.gitStage(projectId, [file.path]))}
              >{t('git.stage')}</button>
              <button
                className="text-[10px] text-status-error hover:underline"
                disabled={busy}
                onClick={() => { if (confirm(t('git.confirmDiscardFile'))) exec(() => projectsApi.gitDiscard(projectId, [file.path])); }}
              >{t('git.discard')}</button>
            </>
          )}
          {type === 'untracked' && (
            <button
              className="text-[10px] text-accent-gold hover:underline"
              disabled={busy}
              onClick={() => exec(() => projectsApi.gitStage(projectId, [file.path]))}
            >{t('git.stage')}</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-1">
      {/* Staged */}
      {staged.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-semibold text-status-success uppercase tracking-wider">{t('git.staged')} ({staged.length})</span>
            <button
              className="text-[10px] text-warm-400 hover:text-warm-600"
              disabled={busy}
              onClick={() => exec(() => projectsApi.gitUnstage(projectId, staged.map(f => f.path)))}
            >{t('git.unstageAll')}</button>
          </div>
          {staged.map(f => <FileRow key={`s-${f.path}`} file={f} type="staged" />)}
        </div>
      )}

      {/* Unstaged */}
      {unstaged.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-semibold text-accent-gold uppercase tracking-wider">{t('git.unstaged')} ({unstaged.length})</span>
            <button
              className="text-[10px] text-warm-400 hover:text-warm-600"
              disabled={busy}
              onClick={() => exec(() => projectsApi.gitStage(projectId, unstaged.map(f => f.path)))}
            >{t('git.stageAll')}</button>
          </div>
          {unstaged.map(f => <FileRow key={`u-${f.path}`} file={f} type="unstaged" />)}
        </div>
      )}

      {/* Untracked */}
      {untracked.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-semibold text-warm-400 uppercase tracking-wider">{t('git.untracked')} ({untracked.length})</span>
            <button
              className="text-[10px] text-warm-400 hover:text-warm-600"
              disabled={busy}
              onClick={() => exec(() => projectsApi.gitStage(projectId, untracked.map(f => f.path)))}
            >{t('git.stageAll')}</button>
          </div>
          {untracked.map(f => <FileRow key={`t-${f.path}`} file={f} type="untracked" />)}
        </div>
      )}
    </div>
  );
}

// --- Refs Sidebar ---

function RefsSidebar({ branches, tags, stashCount }: {
  branches: GitRef[];
  tags: string[];
  stashCount: number;
}) {
  const { t } = useI18n();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['local', 'remote'])
  );

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const localBranches = branches.filter(b => !b.remote);
  const remoteBranches = branches.filter(b => b.remote);

  const SectionHeader = ({ id, label, count }: { id: string; label: string; count: number }) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center gap-1.5 py-1.5 text-[11px] font-semibold text-warm-500 uppercase tracking-wider hover:text-warm-700 transition-colors"
    >
      <svg
        className={`h-3 w-3 transition-transform ${expandedSections.has(id) ? 'rotate-90' : ''}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      {label}
      <span className="text-warm-400 font-normal ml-auto">{count}</span>
    </button>
  );

  return (
    <div className="space-y-1">
      <SectionHeader id="local" label={t('git.branches')} count={localBranches.length} />
      {expandedSections.has('local') && (
        <div className="pl-1 space-y-px">
          {localBranches.map(b => (
            <div
              key={b.name}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs truncate ${
                b.current ? 'text-accent-gold font-semibold bg-accent-gold/10' : 'text-warm-600 hover:bg-warm-50'
              }`}
            >
              {b.current && (
                <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              <span className="truncate">{b.name}</span>
            </div>
          ))}
        </div>
      )}

      {remoteBranches.length > 0 && (
        <>
          <SectionHeader id="remote" label={t('git.remotes')} count={remoteBranches.length} />
          {expandedSections.has('remote') && (
            <div className="pl-1 space-y-px">
              {remoteBranches.map(b => (
                <div key={b.name} className="px-2 py-1 text-xs text-warm-500 truncate hover:bg-warm-50 rounded">
                  {b.name.replace('remotes/', '')}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tags.length > 0 && (
        <>
          <SectionHeader id="tags" label={t('git.tags')} count={tags.length} />
          {expandedSections.has('tags') && (
            <div className="pl-1 space-y-px">
              {tags.map(tag => (
                <div key={tag} className="flex items-center gap-1.5 px-2 py-1 text-xs text-warm-500 truncate hover:bg-warm-50 rounded">
                  <svg className="h-3 w-3 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                  {tag}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {stashCount > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-warm-500 uppercase tracking-wider">
          {t('git.stashes')}
          <span className="text-warm-400 font-normal ml-auto">{stashCount}</span>
        </div>
      )}
    </div>
  );
}

// --- Relative time ---

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo`;
  return `${Math.floor(diffDay / 365)}y`;
}

// --- Main component ---

export default function GitStatusPanel({ project }: GitStatusPanelProps) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitRef[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stashCount, setStashCount] = useState(0);
  const [statusFiles, setStatusFiles] = useState<GitStatusFile[]>([]);
  const [busy, setBusy] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const fetchRefs = useCallback(async () => {
    try {
      const refs = await projectsApi.getGitRefs(project.id);
      setBranches(refs.branches);
      setTags(refs.tags);
      setStashCount(refs.stashCount);
    } catch {
      // non-critical
    }
  }, [project.id]);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await projectsApi.getGitStatusTree(project.id);
      setStatusFiles(result.files);
    } catch {
      // non-critical
    }
  }, [project.id]);

  const fetchLog = useCallback(async (skip: number, reset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await projectsApi.getGitLog(project.id, skip, 50);
      setCommits(prev => reset ? result.commits : [...prev, ...result.commits]);
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch git log');
    } finally {
      setLoading(false);
      setInitialLoading(false);
      loadingRef.current = false;
    }
  }, [project.id]);

  const refresh = useCallback(() => {
    setCommits([]);
    setHasMore(true);
    setInitialLoading(true);
    fetchLog(0, true);
    fetchRefs();
    fetchStatus();
  }, [fetchLog, fetchRefs, fetchStatus]);

  useEffect(() => {
    fetchLog(0, true);
    fetchRefs();
    fetchStatus();
  }, [fetchLog, fetchRefs, fetchStatus]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current && commits.length > 0) {
          fetchLog(commits.length);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, commits.length, fetchLog]);

  const graphNodes = useMemo(() => computeGraphLanes(commits), [commits]);

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}>
      {/* Action Toolbar */}
      <div className="card mb-2 overflow-hidden">
        <ActionToolbar
          projectId={project.id}
          onRefresh={refresh}
          busy={busy}
          setBusy={setBusy}
          branches={branches}
          statusFiles={statusFiles}
        />
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* Left sidebar: Refs + File Status */}
        <div className="w-56 shrink-0 flex flex-col gap-2 min-h-0">
          <div className="card overflow-y-auto p-3 flex-shrink-0" style={{ maxHeight: '45%' }}>
            <RefsSidebar branches={branches} tags={tags} stashCount={stashCount} />
          </div>
          <div className="card overflow-y-auto p-2 flex-1 min-h-0">
            <div className="px-2 py-1 text-[11px] font-semibold text-warm-500 uppercase tracking-wider border-b border-warm-100 mb-1">
              {t('git.fileStatus')} ({statusFiles.length})
            </div>
            <FileStatusSection
              projectId={project.id}
              files={statusFiles}
              busy={busy}
              setBusy={setBusy}
              onRefresh={refresh}
            />
          </div>
        </div>

        {/* Main commit history */}
        <div className="card flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-warm-100">
            <span className="text-sm font-semibold text-warm-700">{t('git.commitHistory')}</span>
            <button
              onClick={refresh}
              disabled={loading}
              className="btn-ghost text-xs flex items-center gap-1.5"
            >
              <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              {t('git.refresh')}
            </button>
          </div>

          {/* Column headers */}
          <div className="flex items-center px-4 py-1.5 border-b border-warm-50 text-[10px] text-warm-400 uppercase tracking-wider">
            <div className="w-24 shrink-0">{t('git.graph')}</div>
            <div className="flex-1 min-w-0">{t('git.description')}</div>
            <div className="w-20 text-right shrink-0">{t('git.date')}</div>
            <div className="w-24 text-right shrink-0">{t('git.author')}</div>
            <div className="w-20 text-right shrink-0">{t('git.hash')}</div>
          </div>

          {error && (
            <div className="p-6 text-center">
              <p className="text-status-error text-sm">{error}</p>
            </div>
          )}

          {initialLoading && !error && (
            <div className="p-6 text-center">
              <p className="text-warm-500 text-sm">{t('detail.loading')}</p>
            </div>
          )}

          {!initialLoading && !error && commits.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-warm-500 text-sm">{t('git.noCommits')}</p>
            </div>
          )}

          {commits.length > 0 && (
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
              <div className="relative flex">
                <div className="shrink-0 sticky left-0">
                  <CommitGraphSvg graphNodes={graphNodes} totalRows={commits.length} />
                </div>

                <div className="flex-1 min-w-0">
                  {commits.map((commit) => (
                    <div
                      key={commit.hash}
                      className="flex items-center px-3 hover:bg-warm-50/50 transition-colors border-b border-warm-50/50"
                      style={{ height: ROW_HEIGHT }}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        {commit.refs.length > 0 && (
                          <div className="flex items-center gap-1 shrink-0">
                            {commit.refs.map((ref, ri) => (
                              <RefBadge key={ri} refStr={ref} />
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-warm-700 truncate">{commit.message}</span>
                      </div>

                      <div className="w-20 text-right shrink-0">
                        <span className="text-[11px] text-warm-400" title={commit.date}>
                          {relativeTime(commit.date)}
                        </span>
                      </div>

                      <div className="w-24 text-right shrink-0">
                        <span className="text-[11px] text-warm-500 truncate inline-block max-w-full">
                          {commit.author}
                        </span>
                      </div>

                      <div className="w-20 text-right shrink-0">
                        <span
                          className="text-[11px] font-mono text-warm-400 cursor-pointer hover:text-accent-gold transition-colors"
                          title={commit.hash}
                          onClick={() => navigator.clipboard.writeText(commit.hash)}
                        >
                          {commit.hash.substring(0, 7)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div ref={sentinelRef} className="h-8 flex items-center justify-center">
                {loading && (
                  <span className="text-xs text-warm-400">{t('git.loadMore')}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
