import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, MinusCircle, AlertTriangle, GitBranch, FolderGit2, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import type { ReviewItem } from '../types';
import type { CommitFile } from '../api/projects';
import { useI18n } from '../i18n';
import * as reviewApi from '../api/review';
import type { ReviewDiffResponse } from '../api/review';
import { CommitDiffViewer, CommitFileList } from './DiffViewer';

interface ReviewCardProps {
  item: ReviewItem;
  focused: boolean;
  expanded: boolean;
  onFocus: () => void;
  onToggleExpand: () => void;
  onOpen: () => void;
  onApprove: () => Promise<void> | void;
  onContinue: (prompt: string) => Promise<void> | void;
  onDiscard: () => Promise<void> | void;
  busy: boolean;
}

const RISK_STYLES: Record<ReviewItem['risk'], { dot: string; label: string }> = {
  low:    { dot: 'bg-status-success', label: 'review.risk.low' },
  medium: { dot: 'bg-status-warning', label: 'review.risk.medium' },
  high:   { dot: 'bg-status-error',   label: 'review.risk.high' },
};

function formatCost(usd: number | null | undefined): string {
  if (!usd) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function formatRelative(iso: string, t: (k: string) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return t('review.justNow');
  const m = Math.floor(ms / 60_000);
  if (m < 1) return t('review.justNow');
  if (m < 60) return `${m}${t('review.minAgo')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${t('review.hourAgo')}`;
  const d = Math.floor(h / 24);
  return `${d}${t('review.dayAgo')}`;
}

function StatusIcon({ status }: { status: ReviewItem['status'] }) {
  if (status === 'completed') return <CheckCircle size={14} className="text-status-success" />;
  if (status === 'failed') return <XCircle size={14} className="text-status-error" />;
  if (status === 'stopped') return <MinusCircle size={14} className="text-status-warning" />;
  return <AlertTriangle size={14} className="text-status-warning" />;
}

function reasonKey(reason: 'todo-not-found' | 'worktree-cleaned' | 'worktree-missing'): string {
  switch (reason) {
    case 'todo-not-found': return 'review.diff.notFound';
    case 'worktree-cleaned': return 'review.diff.cleaned';
    case 'worktree-missing': return 'review.diff.missing';
  }
}

export default function ReviewCard({
  item,
  focused,
  expanded,
  onFocus,
  onToggleExpand,
  onOpen,
  onApprove,
  onContinue,
  onDiscard,
  busy,
}: ReviewCardProps) {
  const { t } = useI18n();
  const [showContinue, setShowContinue] = useState(false);
  const [continuePrompt, setContinuePrompt] = useState('');
  const risk = RISK_STYLES[item.risk];

  const [diffData, setDiffData] = useState<ReviewDiffResponse | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string>('');
  const [fileDiffLoading, setFileDiffLoading] = useState(false);

  const canApprove = item.status === 'completed' && !!item.branch_name && !!item.worktree_path;
  const canContinue = item.status === 'completed' && !!item.worktree_path;

  // Fetch file list lazily on first expand
  useEffect(() => {
    if (!expanded || diffData !== null) return;
    let cancelled = false;
    setFilesLoading(true);
    reviewApi.getReviewDiff(item.id)
      .then((res) => {
        if (cancelled) return;
        setDiffData(res);
        if (res.available && res.files.length > 0) {
          setSelectedFile(res.files[0].path);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDiffData({ available: false, reason: 'worktree-missing' });
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => { cancelled = true; };
  }, [expanded, diffData, item.id]);

  // Fetch unified diff for the selected file
  useEffect(() => {
    if (!expanded || !selectedFile) return;
    let cancelled = false;
    setFileDiffLoading(true);
    setFileDiff('');
    reviewApi.getReviewFileDiff(item.id, selectedFile)
      .then((res) => {
        if (cancelled) return;
        setFileDiff(res.available ? res.diff : '');
      })
      .catch(() => {
        if (!cancelled) setFileDiff('');
      })
      .finally(() => {
        if (!cancelled) setFileDiffLoading(false);
      });
    return () => { cancelled = true; };
  }, [expanded, selectedFile, item.id]);

  const handleCardClick = useCallback(() => {
    onFocus();
    onToggleExpand();
  }, [onFocus, onToggleExpand]);

  // Convert ReviewDiffFile -> CommitFile shape so we can reuse <CommitFileList>
  const fileListItems: CommitFile[] = diffData?.available
    ? diffData.files.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.insertions,
        deletions: f.deletions,
      }))
    : [];

  return (
    <div
      onClick={handleCardClick}
      className={`card p-4 cursor-pointer transition-all ${focused ? 'ring-2' : ''}`}
      style={{
        borderColor: focused ? 'var(--color-accent)' : undefined,
        boxShadow: focused ? 'var(--shadow-soft)' : undefined,
      }}
    >
      {/* Top row: project · title · risk */}
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${risk.dot}`} title={t(risk.label)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-2xs uppercase tracking-wider mb-0.5" style={{ color: 'var(--color-text-muted)' }}>
            <FolderGit2 size={11} />
            <span className="truncate">{item.project_name}</span>
            {item.branch_name && (
              <>
                <span>·</span>
                <GitBranch size={11} />
                <span className="truncate font-mono">{item.branch_name}</span>
              </>
            )}
          </div>
          <h3 className="font-medium truncate flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
            {expanded ? <ChevronDown size={14} className="flex-shrink-0 opacity-60" /> : <ChevronRight size={14} className="flex-shrink-0 opacity-60" />}
            <span className="truncate">{item.title}</span>
          </h3>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          <StatusIcon status={item.status} />
          <span>{formatRelative(item.updated_at, t)}</span>
        </div>
      </div>

      {/* Summary */}
      {item.summary && (
        <p className="mt-2 text-sm line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>
          {item.summary}
        </p>
      )}

      {/* Stats row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>{item.cli_tool || 'claude'}</span>
        <span>·</span>
        <span>{formatCost(item.total_cost_usd)}</span>
        {(item.diff_files || 0) > 0 && (
          <>
            <span>·</span>
            <span>
              {item.diff_files} {t('review.files')}, +{Math.max(0, item.diff_lines ?? 0)} {t('review.lines')}
            </span>
          </>
        )}
        {item.round_count && item.round_count > 1 && (
          <>
            <span>·</span>
            <span>{t('review.rounds')} {item.round_count}</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="btn-ghost text-xs px-3 py-1.5"
        >
          {t('review.viewDetails')}
        </button>
        {canApprove && (
          <button
            onClick={(e) => { e.stopPropagation(); onApprove(); }}
            disabled={busy}
            className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : t('review.approve')}
          </button>
        )}
        {canContinue && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowContinue((v) => !v); }}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            {t('review.requestChanges')}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDiscard(); }}
          disabled={busy}
          className="btn-ghost text-xs px-3 py-1.5 ml-auto text-status-error hover:text-status-error"
        >
          {t('review.discard')}
        </button>
      </div>

      {/* Inline continue prompt */}
      {showContinue && canContinue && (
        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={continuePrompt}
            onChange={(e) => setContinuePrompt(e.target.value)}
            placeholder={t('review.continuePlaceholder')}
            rows={3}
            className="w-full text-sm rounded-lg p-2 resize-y"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowContinue(false); setContinuePrompt(''); }}
              className="btn-ghost text-xs px-3 py-1.5"
            >
              {t('review.cancel')}
            </button>
            <button
              onClick={async () => {
                const p = continuePrompt.trim();
                if (!p) return;
                await onContinue(p);
                setContinuePrompt('');
                setShowContinue(false);
              }}
              disabled={busy || !continuePrompt.trim()}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : t('review.send')}
            </button>
          </div>
        </div>
      )}

      {/* Inline diff expansion */}
      {expanded && (
        <div
          className="mt-3 rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-primary)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {!diffData || filesLoading ? (
            <div className="h-24 flex items-center justify-center">
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            </div>
          ) : !diffData.available ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t(reasonKey(diffData.reason))}
            </div>
          ) : diffData.files.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t('review.diff.empty')}
            </div>
          ) : (
            <div className="flex" style={{ height: 384 }}>
              <div className="w-56 shrink-0 border-r overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                <CommitFileList
                  files={fileListItems}
                  loading={false}
                  selectedFile={selectedFile}
                  onFileClick={(p) => setSelectedFile(p)}
                />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden bg-warm-900">
                <CommitDiffViewer
                  diff={fileDiff}
                  loading={fileDiffLoading}
                  selectedFile={selectedFile}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
