import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import type { GitLogEntry, GitRef, GitStatusFile, CommitFile } from '../api/projects';
import { useI18n } from '../i18n';
import { useMediaQuery } from '../hooks/useMediaQuery';
import Modal from './Modal';
import PushDialog from './PushDialog';
import { CommitDiffViewer, CommitFileList } from './DiffViewer';

interface GitStatusPanelProps {
  project: Project;
  refreshTrigger?: number;
}

// --- Lane assignment algorithm ---

const LANE_COLORS = [
  '#B08A3E', // muted gold
  '#4B8DFF', // action blue
  '#7A8797', // slate
  '#5E748A', // steel
  '#8B8178', // warm gray
  '#667085', // cool gray
  '#78909C', // blue gray
  '#9A8F7F', // stone
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
    classes = 'bg-violet-500/10 text-violet-600 dark:text-violet-400';
  } else if (isHead) {
    label = refStr.replace('HEAD -> ', '');
    classes = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold';
  } else if (isRemote) {
    classes = 'bg-sky-500/10 text-sky-700 dark:text-sky-400';
  } else {
    classes = 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium whitespace-nowrap ${classes}`}>
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

// --- Action Toolbar ---

function ActionToolbar({
  projectId,
  projectName,
  onRefresh,
  busy,
  setBusy,
  branches,
  statusFiles,
}: {
  projectId: string;
  projectName: string;
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
      <span className="text-2xs text-warm-600 whitespace-nowrap">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-accent text-white text-[9px] font-bold rounded-full h-3.5 min-w-[14px] flex items-center justify-center px-0.5">
          {badge}
        </span>
      )}
    </button>
  );

  const GitModal = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Modal open onClose={closeModal} size="sm">
      <div className="bg-theme-card rounded-lg shadow-xl w-80 max-w-[90vw]">
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
    </Modal>
  );

  const localBranches = branches.filter(b => !b.remote);
  const currentLocalBranch = branches.find(b => !b.remote && b.current);
  const commitBadge = statusFiles.length;
  const pullBadge = currentLocalBranch?.behind ?? 0;
  const pushBadge = currentLocalBranch?.ahead ?? 0;

  return (
    <>
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-warm-100 overflow-x-auto">
        <ToolbarBtn label={t('git.commit')} onClick={() => setActiveModal('commit')} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        } badge={commitBadge} />
        <ToolbarBtn label={t('git.pull')} onClick={() => exec(() => projectsApi.gitPull(projectId))} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        } badge={pullBadge} />
        <ToolbarBtn label={t('git.push')} onClick={() => setActiveModal('push')} icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        } badge={pushBadge} />
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
      <PushDialog
        open={activeModal === 'push'}
        onClose={closeModal}
        projectId={projectId}
        projectName={projectName}
        onPushed={onRefresh}
      />

      {activeModal === 'commit' && (
        <GitModal title={t('git.commit')}>
          <textarea
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent"
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
        </GitModal>
      )}

      {activeModal === 'branch' && (
        <GitModal title={t('git.newBranch')}>
          <input
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
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
              <p className="text-2xs text-warm-400 uppercase tracking-wider mb-1">{t('git.selectBranch')}</p>
              <div className="max-h-32 overflow-y-auto space-y-px">
                {localBranches.filter(b => !b.current).map(b => (
                  <div key={b.name} className="flex items-center justify-between px-2 py-1 text-xs hover:bg-warm-50 rounded group">
                    <button
                      className="truncate text-warm-600 hover:text-accent"
                      onClick={() => exec(() => projectsApi.gitCheckout(projectId, b.name))}
                    >
                      {b.name}
                    </button>
                    <button
                      className="text-warm-300 hover:text-status-error opacity-0 group-hover:opacity-100 transition-opacity text-2xs"
                      onClick={() => { if (confirm(`Delete branch ${b.name}?`)) exec(() => projectsApi.gitDeleteBranch(projectId, b.name)); }}
                    >
                      {t('git.delete')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GitModal>
      )}

      {activeModal === 'merge' && (
        <GitModal title={t('git.merge')}>
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
        </GitModal>
      )}

      {activeModal === 'stash' && (
        <StashModal projectId={projectId} busy={busy} exec={exec} inputValue={inputValue} setInputValue={setInputValue} />
      )}

      {activeModal === 'tag' && (
        <GitModal title={t('git.tag')}>
          <input
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder={t('git.tagName')}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            autoFocus
          />
          <input
            className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
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
        </GitModal>
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
    <Modal open onClose={() => setInputValue('')} size="sm">
      <div className="bg-theme-card rounded-lg shadow-xl w-80 max-w-[90vw]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-warm-100">
          <span className="text-sm font-semibold text-warm-700">{t('git.stash')}</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
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
                    className="text-accent hover:underline text-[11px] ml-2 shrink-0"
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
    </Modal>
  );
}

// --- Working Changes View (File Status full view) ---

function fileStatusName(index: string, working_dir: string): { label: string; color: string; type: 'staged' | 'unstaged' | 'untracked' } {
  const isUntracked = index === '?' && working_dir === '?';
  if (isUntracked) return { label: 'U', color: 'text-warm-400', type: 'untracked' };
  const staged = index !== ' ' && index !== '?';
  const unstaged = working_dir !== ' ' && working_dir !== '?';
  const ch = staged ? index : working_dir;
  let color = 'text-accent';
  let label = ch;
  if (ch === 'A') color = 'text-status-success';
  else if (ch === 'D') color = 'text-status-error';
  else if (ch === 'R') color = 'text-violet-600 dark:text-violet-400';
  else if (ch === 'C') color = 'text-blue-500';
  else { color = 'text-accent'; label = 'M'; }
  return { label, color, type: staged ? 'staged' : 'unstaged' };
}

function ChangedFileRow({
  file,
  pane,
  selected,
  checked,
  onClick,
  onToggleCheck,
}: {
  file: GitStatusFile;
  pane: 'staged' | 'unstaged';
  selected: boolean;
  checked: boolean;
  onClick: () => void;
  onToggleCheck: (e: React.MouseEvent | React.ChangeEvent) => void;
}) {
  const status = pane === 'staged'
    ? fileStatusName(file.index, ' ')
    : fileStatusName(' ', file.working_dir === '?' ? '?' : file.working_dir);
  const finalStatus = pane === 'unstaged' && file.index === '?' && file.working_dir === '?'
    ? { label: 'U', color: 'text-warm-400' }
    : status;

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1 cursor-pointer text-xs select-none transition-colors ${
        selected ? 'bg-accent/15 text-accent' : 'hover:bg-warm-50 text-warm-700'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        onClick={e => e.stopPropagation()}
        className="h-3 w-3 shrink-0 cursor-pointer"
        aria-label={file.path}
      />
      <span className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-mono font-bold ${
        pane === 'staged' ? 'bg-emerald-500/15' : 'bg-warm-200'
      } ${finalStatus.color}`}>
        {pane === 'staged' ? '+' : finalStatus.label === 'U' ? '+' : '−'}
      </span>
      <span className="truncate flex-1" title={file.path}>{file.path}</span>
    </div>
  );
}

function WorkingDiffViewer({ diff, loading, file }: { diff: string; loading: boolean; file: GitStatusFile | null }) {
  const { t } = useI18n();

  if (!file) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1A1A1A] text-gray-400">
        <span className="text-sm">{t('git.selectFileForDiff')}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1A1A1A] text-gray-400">
        <span className="text-xs">{t('git.loadingDiff')}</span>
      </div>
    );
  }

  const isUntracked = file.index === '?' && file.working_dir === '?';

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A]">
      <div className="px-3 py-2 border-b border-gray-700 shrink-0 flex items-center gap-2">
        <span className="text-xs font-mono text-gray-100 truncate" title={file.path}>{file.path}</span>
        {isUntracked && <span className="text-2xs text-gray-400 italic">{t('git.untrackedNewFile')}</span>}
      </div>
      <div className="flex-1 overflow-auto">
        {diff ? (
          <pre className="p-3 font-mono text-xs leading-relaxed">
            {diff.split('\n').map((line, i) => {
              let className = 'text-gray-200';
              if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-gray-100 bg-green-500/20';
              else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-gray-100 bg-red-500/20';
              else if (line.startsWith('@@')) className = 'text-blue-400';
              else if (line.startsWith('diff ')) className = 'text-amber-300 font-bold';
              return <div key={i} className={className}>{line || ' '}</div>;
            })}
          </pre>
        ) : (
          <div className="p-6 text-center text-xs text-gray-400 italic">
            {isUntracked ? t('git.untrackedNewFile') : t('git.noFilesChanged')}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkingChangesView({
  projectId,
  branchName,
  files,
  conflicted,
  busy,
  setBusy,
  onRefresh,
  onError,
  isMobile = false,
}: {
  projectId: string;
  branchName: string;
  files: GitStatusFile[];
  conflicted: string[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
  isMobile?: boolean;
}) {
  const { t } = useI18n();
  // Conflicted (unmerged) files get their own pane — their UU/AA/DU codes
  // would otherwise satisfy both the staged and unstaged filters below and
  // show up duplicated in each.
  const conflictSet = useMemo(() => new Set(conflicted), [conflicted]);
  const conflicts = useMemo(() => files.filter(f => conflictSet.has(f.path)), [files, conflictSet]);
  const staged = useMemo(() => files.filter(f => f.index !== ' ' && f.index !== '?' && !conflictSet.has(f.path)), [files, conflictSet]);
  const unstaged = useMemo(() =>
    files.filter(f => (f.working_dir !== ' ' && f.working_dir !== '?') || (f.index === '?' && f.working_dir === '?'))
      .filter(f => !(f.index !== ' ' && f.index !== '?' && f.working_dir === ' '))
      .filter(f => !conflictSet.has(f.path)),
    [files, conflictSet]
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [stagedChecked, setStagedChecked] = useState<Set<string>>(() => new Set());
  const [unstagedChecked, setUnstagedChecked] = useState<Set<string>>(() => new Set());
  const [diff, setDiff] = useState<string>('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [pushAfterCommit, setPushAfterCommit] = useState(false);
  const [committing, setCommitting] = useState(false);

  // Drop checked entries that no longer exist in their pane
  useEffect(() => {
    setStagedChecked(prev => {
      const valid = new Set(staged.map(f => f.path));
      let changed = false;
      const next = new Set<string>();
      prev.forEach(p => { if (valid.has(p)) next.add(p); else changed = true; });
      return changed ? next : prev;
    });
  }, [staged]);
  useEffect(() => {
    setUnstagedChecked(prev => {
      const valid = new Set(unstaged.map(f => f.path));
      let changed = false;
      const next = new Set<string>();
      prev.forEach(p => { if (valid.has(p)) next.add(p); else changed = true; });
      return changed ? next : prev;
    });
  }, [unstaged]);

  const toggleStagedCheck = useCallback((path: string) => {
    setStagedChecked(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);
  const toggleUnstagedCheck = useCallback((path: string) => {
    setUnstagedChecked(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fileListPct, setFileListPct] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.55;
    const raw = window.localStorage.getItem('clitrigger:git:working-pct');
    const v = raw ? parseFloat(raw) : NaN;
    return isNaN(v) ? 0.55 : Math.max(0.3, Math.min(0.8, v));
  });
  useEffect(() => { localStorage.setItem('clitrigger:git:working-pct', String(fileListPct)); }, [fileListPct]);
  const handleHResize = useCallback((clientX: number) => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const pct = (clientX - rect.left) / rect.width;
    setFileListPct(Math.max(0.3, Math.min(0.8, pct)));
  }, []);

  const selectedFile = useMemo(() => {
    if (!selectedKey) return null;
    const [pane, path] = selectedKey.split('::');
    if (pane === 'conflict') return conflicts.find(f => f.path === path) || null;
    if (pane === 'staged') return staged.find(f => f.path === path) || null;
    return unstaged.find(f => f.path === path) || null;
  }, [selectedKey, conflicts, staged, unstaged]);
  const selectedPane: 'conflict' | 'staged' | 'unstaged' | null = selectedKey ? (selectedKey.split('::')[0] as 'conflict' | 'staged' | 'unstaged') : null;

  // Auto-select first file when none is selected
  useEffect(() => {
    if (selectedKey) return;
    if (conflicts.length > 0) setSelectedKey(`conflict::${conflicts[0].path}`);
    else if (staged.length > 0) setSelectedKey(`staged::${staged[0].path}`);
    else if (unstaged.length > 0) setSelectedKey(`unstaged::${unstaged[0].path}`);
  }, [selectedKey, conflicts, staged, unstaged]);

  // Clear selection if the file no longer exists
  useEffect(() => {
    if (!selectedKey) return;
    const [pane, path] = selectedKey.split('::');
    const list = pane === 'conflict' ? conflicts : pane === 'staged' ? staged : unstaged;
    if (!list.some(f => f.path === path)) setSelectedKey(null);
  }, [selectedKey, conflicts, staged, unstaged]);

  // Fetch diff when selection changes
  useEffect(() => {
    if (!selectedFile || !selectedPane) {
      setDiff('');
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    projectsApi.gitDiff(projectId, selectedFile.path, selectedPane === 'staged')
      .then(r => { if (!cancelled) setDiff(r.diff); })
      .catch(() => { if (!cancelled) setDiff(''); })
      .finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, selectedFile, selectedPane]);

  const exec = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try { await fn(); onRefresh(); } catch (err) { onError(err instanceof Error ? err.message : 'Operation failed'); } finally { setBusy(false); }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim() || staged.length === 0) return;
    setCommitting(true);
    setBusy(true);
    onError(null);
    try {
      await projectsApi.gitCommit(projectId, commitMessage.trim());
      if (pushAfterCommit) {
        try { await projectsApi.gitPush(projectId); } catch (err) {
          onError(err instanceof Error ? `Commit OK, push failed: ${err.message}` : 'Push failed');
        }
      }
      setCommitMessage('');
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
      setBusy(false);
    }
  };

  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <span className="text-sm text-warm-400">{t('git.workingTreeClean')}</span>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={`h-full flex min-h-0 ${isMobile ? 'flex-col' : ''}`}>
      {/* Left/top: file lists + commit bar */}
      <div
        style={isMobile ? undefined : { width: `${fileListPct * 100}%`, minWidth: 360 }}
        className={`shrink-0 flex flex-col min-h-0 ${isMobile ? 'h-1/2' : ''}`}
      >
        {/* Conflicts pane — only while unmerged paths exist */}
        {conflicts.length > 0 && (
          <div className="flex flex-col min-h-0 border-b border-warm-200" style={{ flex: '1 1 0' }}>
            <div className="px-3 py-2 border-b border-warm-200 flex items-center shrink-0 bg-status-error/10">
              <span className="text-xs font-semibold text-status-error">
                {t('git.conflicts')} <span className="text-warm-400 font-normal">({conflicts.length})</span>
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conflicts.map(f => (
                <div
                  key={`c-${f.path}`}
                  onClick={() => setSelectedKey(`conflict::${f.path}`)}
                  className={`flex items-center gap-2 px-3 py-1 cursor-pointer text-xs select-none transition-colors ${
                    selectedKey === `conflict::${f.path}` ? 'bg-accent/15 text-accent' : 'hover:bg-warm-50 text-warm-700'
                  }`}
                >
                  <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-mono font-bold bg-status-error/15 text-status-error">C</span>
                  <span className="truncate flex-1" title={f.path}>{f.path}</span>
                  <button
                    className="shrink-0 text-2xs px-1.5 py-0.5 rounded border border-warm-300 text-warm-600 hover:bg-warm-100 disabled:opacity-40"
                    disabled={busy}
                    onClick={e => {
                      e.stopPropagation();
                      exec(() => projectsApi.gitConflictResolve(projectId, f.path, 'ours'));
                    }}
                  >
                    {t('git.acceptOurs')}
                  </button>
                  <button
                    className="shrink-0 text-2xs px-1.5 py-0.5 rounded border border-warm-300 text-warm-600 hover:bg-warm-100 disabled:opacity-40"
                    disabled={busy}
                    onClick={e => {
                      e.stopPropagation();
                      exec(() => projectsApi.gitConflictResolve(projectId, f.path, 'theirs'));
                    }}
                  >
                    {t('git.acceptTheirs')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Staged pane */}
        <div className="flex flex-col min-h-0" style={{ flex: '1 1 0' }}>
          <div className="px-3 py-2 border-b border-warm-200 flex items-center justify-between shrink-0 bg-warm-50">
            <span className="text-xs font-semibold text-warm-700">
              {t('git.stagedFiles')} <span className="text-warm-400 font-normal">({staged.length})</span>
            </span>
            <button
              className="text-2xs text-warm-500 hover:text-warm-700 disabled:opacity-40"
              disabled={busy || staged.length === 0}
              onClick={() => {
                const target = stagedChecked.size > 0
                  ? staged.filter(f => stagedChecked.has(f.path)).map(f => f.path)
                  : staged.map(f => f.path);
                if (target.length === 0) return;
                exec(() => projectsApi.gitUnstage(projectId, target));
              }}
            >
              {stagedChecked.size > 0
                ? `${t('git.unstageSelectedShort')} (${stagedChecked.size})`
                : t('git.unstageAllShort')}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {staged.length === 0 ? (
              <div className="p-3 text-2xs text-warm-400 italic">—</div>
            ) : (
              staged.map(f => (
                <ChangedFileRow
                  key={`s-${f.path}`}
                  file={f}
                  pane="staged"
                  selected={selectedKey === `staged::${f.path}`}
                  checked={stagedChecked.has(f.path)}
                  onClick={() => setSelectedKey(`staged::${f.path}`)}
                  onToggleCheck={() => toggleStagedCheck(f.path)}
                />
              ))
            )}
          </div>
        </div>

        {/* Unstaged pane */}
        <div className="flex flex-col min-h-0 border-t border-warm-200" style={{ flex: '1 1 0' }}>
          <div className="px-3 py-2 border-b border-warm-200 flex items-center justify-between shrink-0 bg-warm-50">
            <span className="text-xs font-semibold text-warm-700">
              {t('git.unstagedFiles')} <span className="text-warm-400 font-normal">({unstaged.length})</span>
            </span>
            <button
              className="text-2xs text-warm-500 hover:text-warm-700 disabled:opacity-40"
              disabled={busy || unstaged.length === 0}
              onClick={() => {
                const target = unstagedChecked.size > 0
                  ? unstaged.filter(f => unstagedChecked.has(f.path)).map(f => f.path)
                  : unstaged.map(f => f.path);
                if (target.length === 0) return;
                exec(() => projectsApi.gitStage(projectId, target));
              }}
            >
              {unstagedChecked.size > 0
                ? `${t('git.stageSelectedShort')} (${unstagedChecked.size})`
                : t('git.stageAllShort')}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {unstaged.length === 0 ? (
              <div className="p-3 text-2xs text-warm-400 italic">—</div>
            ) : (
              unstaged.map(f => (
                <ChangedFileRow
                  key={`u-${f.path}`}
                  file={f}
                  pane="unstaged"
                  selected={selectedKey === `unstaged::${f.path}`}
                  checked={unstagedChecked.has(f.path)}
                  onClick={() => setSelectedKey(`unstaged::${f.path}`)}
                  onToggleCheck={() => toggleUnstagedCheck(f.path)}
                />
              ))
            )}
          </div>
        </div>

        {/* Commit bar */}
        <div className="border-t border-warm-200 shrink-0 bg-theme-bg">
          <div className="p-2">
            <textarea
              className="w-full px-3 py-2 text-sm rounded-md border resize-none focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-warm-400"
              style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
              rows={3}
              placeholder={t('git.commitMessage')}
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleCommit();
              }}
              disabled={committing}
            />
          </div>
          <div className="px-3 py-2 border-t border-warm-200 flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-2xs text-warm-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pushAfterCommit}
                onChange={e => setPushAfterCommit(e.target.checked)}
                className="h-3 w-3"
                disabled={committing}
              />
              {t('git.pushImmediately').replace('{remote}', `origin/${branchName || 'main'}`)}
            </label>
            <button
              className="ml-auto btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
              onClick={handleCommit}
              disabled={committing || busy || !commitMessage.trim() || staged.length === 0 || conflicts.length > 0}
            >
              {committing ? '...' : t('git.commitButton')}
            </button>
          </div>
        </div>
      </div>

      {!isMobile && <Resizer axis="x" onResize={handleHResize} />}

      {/* Right/bottom: diff viewer */}
      <div className={`flex-1 ${isMobile ? 'min-h-0 border-t border-warm-200' : 'min-w-0'}`}>
        <WorkingDiffViewer diff={diff} loading={diffLoading} file={selectedFile} />
      </div>
    </div>
  );
}

// --- Refs Sidebar ---

interface BranchMenuState {
  branch: string;
  isRemote: boolean;
  isCurrent: boolean;
  x: number;
  y: number;
}

function RefsSidebar({ branches, tags, stashCount, projectId, busy, setBusy, onRefresh, onError }: {
  branches: GitRef[];
  tags: string[];
  stashCount: number;
  projectId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}) {
  const { t } = useI18n();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['local', 'remote'])
  );
  const [contextMenu, setContextMenu] = useState<BranchMenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const [worktrees, setWorktrees] = useState<Array<{ path: string; branch: string }>>([]);
  const [cleaningWorktree, setCleaningWorktree] = useState<string | null>(null);

  // Fetch worktrees
  useEffect(() => {
    projectsApi.getWorktrees(projectId).then(r => setWorktrees(r.worktrees)).catch(() => {});
  }, [projectId]);

  // Re-fetch worktrees when onRefresh is triggered (branches change)
  const refreshWorktrees = useCallback(() => {
    projectsApi.getWorktrees(projectId).then(r => setWorktrees(r.worktrees)).catch(() => {});
  }, [projectId]);

  // Refresh worktrees when branches change
  useEffect(() => {
    refreshWorktrees();
  }, [branches, refreshWorktrees]);

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const closeOnScroll = () => setContextMenu(null);
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => { document.removeEventListener('mousedown', handleOutside); document.removeEventListener('scroll', closeOnScroll, true); };
  }, [contextMenu]);

  // Adjust menu position to stay within viewport
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let { x, y } = contextMenu;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu({ ...contextMenu, x, y });
  }, [contextMenu]);

  const exec = async (fn: () => Promise<unknown>, onSuccess?: () => void) => {
    setBusy(true);
    onError(null);
    setContextMenu(null);
    try {
      await fn();
      onRefresh();
      if (onSuccess) onSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, branch: string, isRemote: boolean, isCurrent: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ branch, isRemote, isCurrent, x: e.clientX, y: e.clientY });
  };

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

  const MenuItem = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button
      className={`w-full text-left px-3 py-1.5 hover:bg-theme-hover transition-colors ${danger ? 'text-status-error' : 'text-theme-text'}`}
      disabled={busy}
      onClick={onClick}
    >
      {label}
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs truncate cursor-context-menu select-none ${
                b.current ? 'text-sky-700 dark:text-sky-300 font-semibold bg-sky-500/10' : 'text-warm-600 hover:bg-warm-50'
              }`}
              onContextMenu={e => handleContextMenu(e, b.name, false, !!b.current)}
            >
              {b.current && (
                <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              <span className="truncate">{b.name}</span>
              {(!!b.ahead || !!b.behind) && (
                <span className="ml-auto shrink-0 flex items-center gap-1 px-1.5 rounded-full border border-warm-300 dark:border-warm-600 text-[10px] font-semibold leading-tight">
                  {!!b.ahead && (
                    <span className="text-emerald-700 dark:text-emerald-400" title={`${b.ahead} ${t('git.ahead')}`}>{b.ahead}↑</span>
                  )}
                  {!!b.behind && (
                    <span className="text-amber-700 dark:text-amber-400" title={`${b.behind} ${t('git.behind')}`}>{b.behind}↓</span>
                  )}
                </span>
              )}
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
                <div
                  key={b.name}
                  className="px-2 py-1 text-xs text-warm-500 truncate hover:bg-warm-50 rounded cursor-context-menu select-none"
                  onContextMenu={e => handleContextMenu(e, b.name, true, false)}
                >
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
                  <svg className="h-3 w-3 text-violet-600/80 dark:text-violet-400/80 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

      {worktrees.length > 0 && (
        <>
          <SectionHeader id="worktrees" label={t('git.worktrees')} count={worktrees.length} />
          {expandedSections.has('worktrees') && (
            <div className="pl-1 space-y-px">
              {worktrees.map(wt => (
                <div
                  key={wt.path}
                  className="group flex items-center gap-1.5 px-2 py-1 text-xs text-warm-600 hover:bg-warm-50 dark:hover:bg-warm-800/50 rounded"
                >
                  <svg className="h-3 w-3 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="truncate flex-1" title={wt.path}>{wt.branch}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 text-warm-400 hover:text-status-error transition-all"
                    disabled={busy || cleaningWorktree === wt.path}
                    title={t('git.cleanupWorktree')}
                    onClick={() => {
                      if (confirm(t('git.confirmCleanupWorktree').replace('{name}', wt.branch))) {
                        setCleaningWorktree(wt.path);
                        setBusy(true);
                        onError(null);
                        projectsApi.cleanupWorktree(projectId, wt.path, wt.branch)
                          .then(() => {
                            setWorktrees(prev => prev.filter(w => w.path !== wt.path));
                            onRefresh();
                          })
                          .catch(err => onError(err instanceof Error ? err.message : 'Error'))
                          .finally(() => { setCleaningWorktree(null); setBusy(false); });
                      }
                    }}
                  >
                    {cleaningWorktree === wt.path ? (
                      <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    ) : (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
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

      {/* Branch context menu */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-tooltip bg-theme-card border border-warm-200 dark:border-warm-700 rounded-lg shadow-elevated py-1 min-w-[220px] text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* Checkout */}
          {!contextMenu.isCurrent && !contextMenu.isRemote && (
            <MenuItem
              label={`${t('git.checkout')} ${contextMenu.branch}`}
              onClick={() => exec(() => projectsApi.gitCheckout(projectId, contextMenu.branch))}
            />
          )}
          {!contextMenu.isCurrent && contextMenu.isRemote && (
            <MenuItem
              label={`${t('git.checkoutRemote')} ${contextMenu.branch.replace(/^(remotes\/)?origin\//, '')}`}
              onClick={() => {
                const localName = contextMenu.branch.replace(/^(remotes\/)?origin\//, '');
                exec(() => projectsApi.gitCheckout(projectId, localName));
              }}
            />
          )}

          {/* Merge / Rebase */}
          {!contextMenu.isCurrent && (
            <MenuItem
              label={`${t('git.mergeInto')} ${contextMenu.branch}`}
              onClick={() => exec(() => projectsApi.gitMerge(projectId, contextMenu.branch))}
            />
          )}
          {!contextMenu.isCurrent && !contextMenu.isRemote && (
            <MenuItem
              label={`${t('git.rebaseOnto')} ${contextMenu.branch}`}
              onClick={() => exec(() => projectsApi.gitRebase(projectId, contextMenu.branch))}
            />
          )}

          <div className="border-t border-warm-100 dark:border-warm-700 my-1" />

          {/* Fetch / Pull / Push */}
          <MenuItem
            label={`${t('git.fetch')}`}
            onClick={() => exec(() => projectsApi.gitFetch(projectId))}
          />
          {!contextMenu.isRemote && (
            <>
              <MenuItem
                label={`${t('git.pull')}`}
                onClick={() => exec(() => projectsApi.gitPull(projectId))}
              />
              <MenuItem
                label={`${t('git.push')}`}
                onClick={() => exec(() => projectsApi.gitPush(projectId))}
              />
            </>
          )}

          {/* Rename / Delete (local only) */}
          {!contextMenu.isRemote && (
            <>
              <div className="border-t border-warm-100 dark:border-warm-700 my-1" />
              <MenuItem
                label={`${t('git.renameBranch')} ${contextMenu.branch}...`}
                onClick={() => {
                  setRenaming(contextMenu.branch);
                  setRenameValue(contextMenu.branch);
                  setContextMenu(null);
                }}
              />
              {!contextMenu.isCurrent && (() => {
                const wt = worktrees.find(w => w.branch === contextMenu.branch);
                if (wt) {
                  return (
                    <MenuItem
                      danger
                      label={`${t('git.deleteWorktreeAndBranch')} ${contextMenu.branch}`}
                      onClick={() => {
                        if (confirm(t('git.confirmDeleteWorktreeAndBranch').replace('{name}', contextMenu.branch))) {
                          exec(() => projectsApi.cleanupWorktree(projectId, wt.path, contextMenu.branch));
                        } else {
                          setContextMenu(null);
                        }
                      }}
                    />
                  );
                }
                const branchName = contextMenu.branch;
                return (
                  <MenuItem
                    danger
                    label={`${t('git.delete')} ${branchName}`}
                    onClick={() => {
                      if (!confirm(t('git.confirmDelete').replace('{name}', branchName))) {
                        setContextMenu(null);
                        return;
                      }
                      exec(async () => {
                        try {
                          await projectsApi.gitDeleteBranch(projectId, branchName);
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : '';
                          if (/not fully merged/i.test(msg)) {
                            if (confirm(t('git.confirmForceDelete').replace('{name}', branchName))) {
                              await projectsApi.gitDeleteBranch(projectId, branchName, true);
                              return;
                            }
                          }
                          throw err;
                        }
                      });
                    }}
                  />
                );
              })()}
            </>
          )}
        </div>,
        document.body
      )}

      {/* Rename branch modal */}
      {renaming && (
        <Modal open onClose={() => setRenaming(null)} size="sm">
          <div className="bg-theme-card rounded-lg shadow-xl w-80 max-w-[90vw]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-warm-100">
              <span className="text-sm font-semibold text-warm-700">{t('git.renameBranch')}</span>
              <button onClick={() => setRenaming(null)} className="text-warm-400 hover:text-warm-600">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-warm-500">{renaming} →</p>
              <input
                className="w-full border border-warm-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent bg-transparent"
                placeholder={t('git.newBranchName')}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && renameValue.trim() && renameValue.trim() !== renaming) {
                    const oldName = renaming;
                    exec(() => projectsApi.gitRenameBranch(projectId, oldName, renameValue.trim()), () => setRenaming(null));
                  }
                }}
                autoFocus
              />
              <button
                className="w-full btn-primary text-sm py-2"
                disabled={busy || !renameValue.trim() || renameValue.trim() === renaming}
                onClick={() => {
                  const oldName = renaming;
                  exec(() => projectsApi.gitRenameBranch(projectId, oldName, renameValue.trim()), () => setRenaming(null));
                }}
              >
                {t('git.rename')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Commit date formatting ---

function formatCommitDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

// --- Workspace view selector ---

type WorkspaceView = 'fileStatus' | 'history';

function WorkspaceMenu({
  view,
  onChange,
  fileChangeCount,
  orientation = 'vertical',
}: {
  view: WorkspaceView;
  onChange: (v: WorkspaceView) => void;
  fileChangeCount: number;
  orientation?: 'vertical' | 'horizontal';
}) {
  const { t } = useI18n();
  const horizontal = orientation === 'horizontal';

  const Item = ({ id, label, badge }: { id: WorkspaceView; label: string; badge?: number }) => {
    const active = view === id;
    return (
      <button
        onClick={() => onChange(id)}
        className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded transition-colors ${
          horizontal ? 'flex-1 justify-center' : 'w-full'
        } ${
          active
            ? 'bg-accent/10 text-accent shadow-soft ring-1 ring-inset ring-accent/20'
            : 'text-warm-600 hover:bg-warm-200/60'
        }`}
      >
        <span className={`${horizontal ? '' : 'flex-1 text-left'} truncate`}>{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            active ? 'bg-accent/10 text-accent' : 'bg-warm-200 text-warm-600'
          }`}>
            {badge}
          </span>
        )}
      </button>
    );
  };

  if (horizontal) {
    return (
      <div className="flex items-center gap-1">
        <Item id="fileStatus" label={t('git.viewFileStatus')} badge={fileChangeCount} />
        <Item id="history" label={t('git.viewHistory')} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="px-2 text-[10px] font-bold text-warm-400 uppercase tracking-widest flex items-center gap-2">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        {t('git.workspace')}
      </div>
      <div className="space-y-0.5">
        <Item id="fileStatus" label={t('git.viewFileStatus')} badge={fileChangeCount} />
        <Item id="history" label={t('git.viewHistory')} />
      </div>
    </div>
  );
}

// --- Resizer ---

function Resizer({ axis, onResize }: { axis: 'x' | 'y'; onResize: (clientX: number, clientY: number) => void }) {
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        const onMove = (ev: MouseEvent) => onResize(ev.clientX, ev.clientY);
        const onUp = () => {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      className={
        axis === 'x'
          ? 'w-1 mx-1 shrink-0 cursor-col-resize bg-warm-200/60 hover:bg-accent transition-colors rounded'
          : 'h-1 my-0.5 shrink-0 cursor-row-resize bg-warm-200/60 hover:bg-accent transition-colors'
      }
    />
  );
}

// --- Long-press message tooltip (mobile only) ---

function LongPressTooltip({ x, y, message, onDismiss }: { x: number; y: number; message: string; onDismiss: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = y - h - 12;
    if (top < 8) top = y + 12;
    if (top + h > vh - 8) top = vh - h - 8;
    let left = x - w / 2;
    if (left < 8) left = 8;
    if (left + w > vw - 8) left = vw - w - 8;
    setPos({ top, left });
  }, [x, y]);

  return createPortal(
    <div
      onClick={onDismiss}
      onTouchStart={onDismiss}
      className="fixed inset-0 z-tooltip"
    >
      <div
        ref={boxRef}
        className="absolute bg-warm-800 dark:bg-warm-900 text-white text-xs px-3 py-2 rounded-lg shadow-elevated max-w-[80vw] whitespace-pre-wrap break-words pointer-events-none"
        style={pos ? { top: pos.top, left: pos.left, opacity: 1 } : { top: 0, left: 0, opacity: 0 }}
      >
        {message}
      </div>
    </div>,
    document.body,
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function readNumber(key: string, fallback: number, lo: number, hi: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const v = parseFloat(raw);
  return isNaN(v) ? fallback : clamp(v, lo, hi);
}

// --- Main component ---

export default function GitStatusPanel({ project, refreshTrigger }: GitStatusPanelProps) {
  const { t } = useI18n();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [refsOpen, setRefsOpen] = useState(false);
  const [pressTooltip, setPressTooltip] = useState<{ message: string; x: number; y: number } | null>(null);
  const longPressRef = useRef<{ timer: number | null; startX: number; startY: number; fired: boolean }>({
    timer: null, startX: 0, startY: 0, fired: false,
  });
  const [view, setView] = useState<WorkspaceView>(() => {
    if (typeof window === 'undefined') return 'history';
    const saved = window.localStorage.getItem(`git-view:${project.id}`);
    return (saved === 'fileStatus' || saved === 'history') ? saved : 'history';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(`git-view:${project.id}`, view);
  }, [view, project.id]);

  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitRef[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stashCount, setStashCount] = useState(0);
  const [statusFiles, setStatusFiles] = useState<GitStatusFile[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  // In-progress merge/rebase + conflicted paths. Source of truth is the git
  // repo itself (via git-status), so conflicts created in a terminal show up
  // here too. `conflicted` can be non-empty without merging/rebasing
  // (cherry-pick, stash pop) — the resolve buttons still work there.
  const [opState, setOpState] = useState<{ merging: boolean; rebasing: boolean; conflicted: string[] }>({
    merging: false, rebasing: false, conflicted: [],
  });
  const [busy, setBusy] = useState(false);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string>('');
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const outerRef = useRef<HTMLDivElement>(null);
  const historyAreaRef = useRef<HTMLDivElement>(null);
  const detailAreaRef = useRef<HTMLDivElement>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readNumber('clitrigger:git:sidebar-w', 224, 180, 480));
  const [detailHeightPct, setDetailHeightPct] = useState<number>(() => readNumber('clitrigger:git:detail-h-pct', 0.5, 0.2, 0.8));
  const [detailFileListWidth, setDetailFileListWidth] = useState<number>(() => readNumber('clitrigger:git:detail-fl-w', 240, 160, 500));

  useEffect(() => { localStorage.setItem('clitrigger:git:sidebar-w', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('clitrigger:git:detail-h-pct', String(detailHeightPct)); }, [detailHeightPct]);
  useEffect(() => { localStorage.setItem('clitrigger:git:detail-fl-w', String(detailFileListWidth)); }, [detailFileListWidth]);

  const handleSidebarResize = useCallback((clientX: number) => {
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    setSidebarWidth(clamp(clientX - rect.left, 180, 480));
  }, []);

  const handleDetailHResize = useCallback((_x: number, clientY: number) => {
    if (!historyAreaRef.current) return;
    const rect = historyAreaRef.current.getBoundingClientRect();
    setDetailHeightPct(clamp((rect.bottom - clientY) / rect.height, 0.2, 0.8));
  }, []);

  const handleDetailFileListResize = useCallback((clientX: number) => {
    if (!detailAreaRef.current) return;
    const rect = detailAreaRef.current.getBoundingClientRect();
    setDetailFileListWidth(clamp(clientX - rect.left, 160, 500));
  }, []);

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
      setCurrentBranch(result.branch || '');
      setOpState({
        merging: !!result.mergeInProgress,
        rebasing: !!result.rebaseInProgress,
        conflicted: result.conflicted ?? [],
      });
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
    setSelectedCommit(null);
    setCommitFiles([]);
    setSelectedFile(null);
    setFileDiff('');
    fetchLog(0, true);
    fetchRefs();
    fetchStatus();
  }, [fetchLog, fetchRefs, fetchStatus]);

  const runConflictAction = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setSidebarError(null);
    try { await fn(); } catch (err) {
      setSidebarError(err instanceof Error ? err.message : 'Operation failed');
    } finally { setBusy(false); refresh(); }
  }, [refresh]);

  const handleCommitClick = useCallback(async (commit: GitLogEntry) => {
    if (selectedCommit?.hash === commit.hash) {
      setSelectedCommit(null);
      setCommitFiles([]);
      setSelectedFile(null);
      setFileDiff('');
      return;
    }
    setSelectedCommit(commit);
    setSelectedFile(null);
    setFileDiff('');
    setCommitFilesLoading(true);
    try {
      const result = await projectsApi.getCommitFiles(project.id, commit.hash);
      setCommitFiles(result.files);
      if (result.files.length > 0) {
        const firstFile = result.files[0].path;
        setSelectedFile(firstFile);
        setFileDiffLoading(true);
        try {
          const diffResult = await projectsApi.getCommitDiff(project.id, commit.hash, firstFile);
          setFileDiff(diffResult.diff);
        } catch { setFileDiff(''); }
        finally { setFileDiffLoading(false); }
      }
    } catch {
      setCommitFiles([]);
    } finally {
      setCommitFilesLoading(false);
    }
  }, [project.id, selectedCommit?.hash]);

  const handleFileClick = useCallback(async (filePath: string) => {
    if (!selectedCommit) return;
    setSelectedFile(filePath);
    setFileDiffLoading(true);
    try {
      const result = await projectsApi.getCommitDiff(project.id, selectedCommit.hash, filePath);
      setFileDiff(result.diff);
    } catch {
      setFileDiff('');
    } finally {
      setFileDiffLoading(false);
    }
  }, [project.id, selectedCommit]);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current.timer !== null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  }, []);

  const handleCommitPointerDown = useCallback((e: React.PointerEvent, message: string) => {
    if (!isMobile) return;
    cancelLongPress();
    longPressRef.current.startX = e.clientX;
    longPressRef.current.startY = e.clientY;
    longPressRef.current.fired = false;
    longPressRef.current.timer = window.setTimeout(() => {
      longPressRef.current.fired = true;
      longPressRef.current.timer = null;
      setPressTooltip({ message, x: longPressRef.current.startX, y: longPressRef.current.startY });
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(10); } catch { /* ignore */ }
      }
    }, 500);
  }, [isMobile, cancelLongPress]);

  const handleCommitPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isMobile || longPressRef.current.timer === null) return;
    const dx = e.clientX - longPressRef.current.startX;
    const dy = e.clientY - longPressRef.current.startY;
    if (dx * dx + dy * dy > 64) cancelLongPress();
  }, [isMobile, cancelLongPress]);

  const handleCommitPointerEnd = useCallback(() => {
    if (!isMobile) return;
    cancelLongPress();
  }, [isMobile, cancelLongPress]);

  // Auto-dismiss tooltip on scroll / resize / mobile state change
  useEffect(() => {
    if (!pressTooltip) return;
    const dismiss = () => setPressTooltip(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [pressTooltip]);

  useEffect(() => {
    if (!isMobile) setPressTooltip(null);
  }, [isMobile]);

  useEffect(() => {
    fetchLog(0, true);
    fetchRefs();
    fetchStatus();
  }, [fetchLog, fetchRefs, fetchStatus]);

  // Auto-refresh when tasks complete (refreshTrigger changes)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      refresh();
    }
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

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
          projectName={project.name}
          onRefresh={refresh}
          busy={busy}
          setBusy={setBusy}
          branches={branches}
          statusFiles={statusFiles}
        />
      </div>

      {/* In-progress merge/rebase + conflicts */}
      {(opState.merging || opState.rebasing || opState.conflicted.length > 0) && (
        <div className="mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2 rounded border border-amber-200 dark:border-amber-800">
          <span className="font-semibold shrink-0">
            {opState.merging ? t('git.conflictMergeInProgress')
              : opState.rebasing ? t('git.conflictRebaseInProgress')
              : t('git.conflicts')}
          </span>
          <span className="flex-1 min-w-0 truncate">
            {opState.conflicted.length > 0
              ? t('git.conflictBanner').replace('{n}', String(opState.conflicted.length))
              : t('git.conflictAllResolved')}
          </span>
          {view !== 'fileStatus' && opState.conflicted.length > 0 && (
            <button
              className="shrink-0 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              onClick={() => setView('fileStatus')}
            >
              {t('git.viewConflicts')}
            </button>
          )}
          {(opState.merging || opState.rebasing) && (
            <>
              <button
                className="shrink-0 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40"
                disabled={busy || opState.conflicted.length > 0}
                onClick={() => runConflictAction(() => projectsApi.gitConflictContinue(project.id))}
              >
                {t('git.conflictContinue')}
              </button>
              <button
                className="shrink-0 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('git.confirmConflictAbort'))) {
                    runConflictAction(() => projectsApi.gitConflictAbort(project.id));
                  }
                }}
              >
                {t('git.conflictAbort')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Sidebar error (branch/tag actions) */}
      {sidebarError && (
        <div className="mb-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs flex items-center justify-between rounded border border-red-200 dark:border-red-800">
          <span>{sidebarError}</span>
          <button onClick={() => setSidebarError(null)} className="ml-2 shrink-0 hover:text-red-800 dark:hover:text-red-300">&times;</button>
        </div>
      )}

      <div ref={outerRef} className={`flex flex-1 min-h-0 ${isMobile ? 'flex-col gap-2' : ''}`}>
        {/* Sidebar: Workspace menu + Refs (vertical on desktop, stacked on top on mobile) */}
        <div
          style={isMobile ? undefined : { width: sidebarWidth }}
          className={`shrink-0 flex flex-col gap-2 ${isMobile ? '' : 'min-h-0'}`}
        >
          {isMobile ? (
            <div className="card p-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <WorkspaceMenu
                  view={view}
                  onChange={setView}
                  fileChangeCount={statusFiles.length}
                  orientation="horizontal"
                />
              </div>
              <button
                onClick={() => setRefsOpen(o => !o)}
                className="btn-ghost text-xs flex items-center gap-1 shrink-0 px-3 py-2"
                aria-expanded={refsOpen}
              >
                <svg className={`h-3 w-3 transition-transform ${refsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                {t('git.branches')}
              </button>
            </div>
          ) : (
            <div className="card p-3 shrink-0">
              <WorkspaceMenu
                view={view}
                onChange={setView}
                fileChangeCount={statusFiles.length}
              />
            </div>
          )}
          {(!isMobile || refsOpen) && (
            <div
              className={`card overflow-y-auto p-3 ${isMobile ? '' : 'flex-1 min-h-0'}`}
              style={isMobile ? { maxHeight: '40vh' } : undefined}
            >
              <RefsSidebar branches={branches} tags={tags} stashCount={stashCount} projectId={project.id} busy={busy} setBusy={setBusy} onRefresh={refresh} onError={setSidebarError} />
            </div>
          )}
        </div>

        {!isMobile && <Resizer axis="x" onResize={handleSidebarResize} />}

        {/* Main view */}
        <div className="card flex-1 overflow-hidden flex flex-col min-h-0">
          {view === 'fileStatus' ? (
            <WorkingChangesView
              projectId={project.id}
              branchName={currentBranch}
              files={statusFiles}
              conflicted={opState.conflicted}
              busy={busy}
              setBusy={setBusy}
              onRefresh={refresh}
              onError={setSidebarError}
              isMobile={isMobile}
            />
          ) : (
            <>
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
              <div className={`flex items-center py-1.5 border-b border-warm-50 text-2xs text-warm-400 uppercase tracking-wider ${isMobile ? 'px-3' : 'px-4'}`}>
                {!isMobile && <div className="w-24 shrink-0">{t('git.graph')}</div>}
                <div className="flex-1 min-w-0">{t('git.description')}</div>
                <div className="w-14 text-right shrink-0">{t('git.date')}</div>
                {!isMobile && <div className="shrink-0 ml-2">{t('git.author')}</div>}
                <div className="w-16 text-right shrink-0">{t('git.hash')}</div>
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
                <div ref={historyAreaRef} className="flex-1 flex flex-col min-h-0">
                <div
                  className="overflow-y-auto"
                  ref={scrollRef}
                  style={
                    selectedCommit
                      ? { flex: `${(1 - detailHeightPct) * 100} 1 0`, minHeight: 0 }
                      : { flex: '1 1 0', minHeight: 0 }
                  }
                >
                  <div className="relative flex">
                    {!isMobile && (
                      <div className="shrink-0 sticky left-0">
                        <CommitGraphSvg graphNodes={graphNodes} totalRows={commits.length} />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      {commits.map((commit) => {
                        const isSelected = selectedCommit?.hash === commit.hash;
                        return (
                          <div
                            key={commit.hash}
                            onClick={(e) => {
                              if (longPressRef.current.fired) {
                                e.stopPropagation();
                                longPressRef.current.fired = false;
                                return;
                              }
                              handleCommitClick(commit);
                            }}
                            onPointerDown={(e) => handleCommitPointerDown(e, commit.message)}
                            onPointerMove={handleCommitPointerMove}
                            onPointerUp={handleCommitPointerEnd}
                            onPointerCancel={handleCommitPointerEnd}
                            onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
                            className={`flex items-center px-3 cursor-pointer transition-colors border-b border-warm-50/20 ${
                              isSelected ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-warm-50/50'
                            }`}
                            style={{
                              height: ROW_HEIGHT,
                              ...(isMobile ? { touchAction: 'pan-y', WebkitTouchCallout: 'none', userSelect: 'none' } : null),
                            }}
                          >
                            <div className="flex-1 min-w-0 flex items-center gap-1.5">
                              {commit.refs.length > 0 && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {commit.refs.map((ref, ri) => (
                                    <RefBadge key={ri} refStr={ref} />
                                  ))}
                                </div>
                              )}
                              <span className="text-xs text-warm-700 truncate" title={commit.message}>{commit.message}</span>
                            </div>

                            <div className="w-28 text-right shrink-0">
                              <span className="text-[11px] font-mono text-warm-600" title={commit.date}>
                                {formatCommitDate(commit.date)}
                              </span>
                            </div>

                            {!isMobile && (
                              <div className="shrink-0 ml-2">
                                <span className="text-[11px] text-warm-600">
                                  {commit.author}
                                </span>
                              </div>
                            )}

                            <div className="w-16 text-right shrink-0">
                              <span
                                className="text-[11px] font-mono text-warm-600 cursor-pointer hover:text-accent transition-colors"
                                title={commit.hash}
                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(commit.hash); }}
                              >
                                {commit.hash.substring(0, 7)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div ref={sentinelRef} className="h-8 flex items-center justify-center">
                    {loading && (
                      <span className="text-xs text-warm-400">{t('git.loadMore')}</span>
                    )}
                  </div>
                </div>

                {/* Commit detail panel */}
                {selectedCommit && (
                  <>
                    <Resizer axis="y" onResize={handleDetailHResize} />
                    <div
                      ref={detailAreaRef}
                      className={`flex min-h-0 ${isMobile ? 'flex-col' : ''}`}
                      style={{ flex: `${detailHeightPct * 100} 1 0`, minHeight: 0 }}
                    >
                      <div
                        style={isMobile ? undefined : { width: detailFileListWidth }}
                        className={`shrink-0 overflow-hidden ${isMobile ? 'h-1/2' : ''}`}
                      >
                        <CommitFileList
                          files={commitFiles}
                          loading={commitFilesLoading}
                          selectedFile={selectedFile}
                          onFileClick={handleFileClick}
                          commitHash={selectedCommit.hash}
                        />
                      </div>
                      {!isMobile && <Resizer axis="x" onResize={handleDetailFileListResize} />}
                      <div className={`flex-1 overflow-hidden bg-warm-900 ${isMobile ? 'min-h-0 border-t border-warm-200' : 'min-w-0'}`}>
                        <CommitDiffViewer
                          diff={fileDiff}
                          loading={fileDiffLoading}
                          selectedFile={selectedFile}
                        />
                      </div>
                    </div>
                  </>
                )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {pressTooltip && (
        <LongPressTooltip
          x={pressTooltip.x}
          y={pressTooltip.y}
          message={pressTooltip.message}
          onDismiss={() => setPressTooltip(null)}
        />
      )}
    </div>
  );
}
