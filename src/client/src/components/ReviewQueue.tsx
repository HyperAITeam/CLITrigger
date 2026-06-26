import { useEffect, useMemo, useState, useCallback } from 'react';
import { Inbox, RefreshCw, X } from 'lucide-react';
import type { ReviewItem, ReviewSummary, TaskLog } from '../types';
import * as reviewApi from '../api/review';
import * as todosApi from '../api/todos';
import { useI18n } from '../i18n';
import type { WsEvent } from '../hooks/useWebSocket';
import LogViewer from './LogViewer';
import { Skeleton } from './Skeleton';
import ReviewCard from './ReviewCard';

interface ReviewQueueProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

type WindowHours = 12 | 24 | 168;
type FilterMode = 'all' | 'risky' | 'quickWins' | 'failed';

const WINDOWS: Array<{ hours: WindowHours; key: string }> = [
  { hours: 12, key: 'review.window.12h' },
  { hours: 24, key: 'review.window.24h' },
  { hours: 168, key: 'review.window.7d' },
];

const FILTERS: Array<{ id: FilterMode; key: string }> = [
  { id: 'all', key: 'review.filter.all' },
  { id: 'risky', key: 'review.filter.risky' },
  { id: 'quickWins', key: 'review.filter.quickWins' },
  { id: 'failed', key: 'review.filter.failed' },
];

function formatTokens(n: number): string {
  if (!n) return '0';
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

function applyFilter(items: ReviewItem[], filter: FilterMode): ReviewItem[] {
  switch (filter) {
    case 'all':
      return items;
    case 'risky':
      return items.filter((i) => i.risk === 'high' || i.status === 'failed');
    case 'quickWins':
      return items.filter((i) => i.risk === 'low' && i.status === 'completed' && (i.total_cost_usd ?? 0) < 1);
    case 'failed':
      return items.filter((i) => i.status === 'failed' || i.status === 'stopped');
  }
}

export default function ReviewQueue({ onEvent }: ReviewQueueProps) {
  const { t } = useI18n();
  const [hours, setHours] = useState<WindowHours>(24);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusIdx, setFocusIdx] = useState(0);
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [openItem, setOpenItem] = useState<ReviewItem | null>(null);
  const [openLogs, setOpenLogs] = useState<TaskLog[]>([]);
  const [openLoading, setOpenLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const filtered = useMemo(() => applyFilter(items, filter), [items, filter]);

  const scrollFocusedIntoView = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, sum] = await Promise.all([
        reviewApi.getReviewQueue({ hours }),
        reviewApi.getReviewSummary({ hours }),
      ]);
      setItems(queue.items);
      setSummary(sum);
    } catch {
      // ignore — UI will show empty state
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep focus index inside bounds when filter changes
  useEffect(() => {
    if (focusIdx >= filtered.length) setFocusIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, focusIdx]);

  // WebSocket: refresh on todo status changes
  useEffect(() => {
    return onEvent((event) => {
      if (event.type === 'todo:status-changed') {
        load();
      }
    });
  }, [onEvent, load]);

  const setBusy = (id: string, on: boolean) => {
    setBusyMap((prev) => ({ ...prev, [id]: on }));
  };

  const removeFromQueue = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    // Item left the review set — tell the sidebar badge to recount.
    window.dispatchEvent(new Event('review:changed'));
  };

  const handleApprove = useCallback(async (item: ReviewItem) => {
    setBusy(item.id, true);
    try {
      await todosApi.mergeTodo(item.id);
      removeFromQueue(item.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`${t('review.mergeFailed')}: ${msg}`);
    } finally {
      setBusy(item.id, false);
    }
  }, [t]);

  const handleContinue = useCallback(async (item: ReviewItem, prompt: string) => {
    setBusy(item.id, true);
    try {
      await todosApi.continueTodo(item.id, prompt);
      // It re-enters running state; status-changed event will refresh.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`${t('review.continueFailed')}: ${msg}`);
    } finally {
      setBusy(item.id, false);
    }
  }, [t]);

  const handleDiscard = useCallback(async (item: ReviewItem) => {
    if (!confirm(t('review.discardConfirm'))) return;
    setBusy(item.id, true);
    try {
      // Discard = scrap the todo: clean its worktree/branch, then delete the
      // row so it leaves the review set (cleanup alone leaves status untouched,
      // so the item — and the badge — would otherwise come back on reload).
      await todosApi.cleanupTodo(item.id, true);
      await todosApi.deleteTodo(item.id);
      removeFromQueue(item.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`${t('review.discardFailed')}: ${msg}`);
    } finally {
      setBusy(item.id, false);
    }
  }, [t]);

  const handleOpen = useCallback(async (item: ReviewItem) => {
    setOpenItem(item);
    setOpenLogs([]);
    setOpenLoading(true);
    try {
      const logs = await todosApi.getTodoLogs(item.id);
      setOpenLogs(logs);
    } catch {
      // ignore
    } finally {
      setOpenLoading(false);
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const cur = filtered[focusIdx];
        if (cur) handleOpen(cur);
      } else if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = filtered[focusIdx];
        if (cur) toggleExpand(cur.id);
      } else if (e.key === 'Escape') {
        if (openItem) setOpenItem(null);
        else if (expandedId) setExpandedId(null);
      } else if (e.key === 'm') {
        const cur = filtered[focusIdx];
        if (cur && cur.status === 'completed' && cur.branch_name) handleApprove(cur);
      } else if (e.key === 'd') {
        const cur = filtered[focusIdx];
        if (cur) handleDiscard(cur);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, focusIdx, openItem, expandedId, toggleExpand, handleApprove, handleDiscard, handleOpen]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
              <Inbox size={20} />
              {t('review.title')}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('review.subtitle')}
            </p>
          </div>
          <button
            onClick={load}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {t('review.refresh')}
          </button>
        </div>

        {/* Cost ribbon */}
        <div
          className="mx-6 mb-3 rounded-xl px-4 py-3 flex items-center flex-wrap gap-x-6 gap-y-2"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div>
            <div className="text-2xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              {t('review.tokens.total')}
            </div>
            <div className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {summary ? formatTokens(summary.total_tokens) : '—'}
            </div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              {t('review.tokens.todos')}
            </div>
            <div className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {summary?.total_todos ?? '—'}
            </div>
          </div>
          {summary && summary.by_cli.length > 0 && (
            <div className="flex-1 min-w-[200px]">
              <div className="text-2xs uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('review.tokens.byCli')}
              </div>
              <div className="flex gap-3 text-xs flex-wrap">
                {summary.by_cli.map((c) => (
                  <span key={c.cli_tool} style={{ color: 'var(--color-text-secondary)' }}>
                    {c.cli_tool}: <strong>{formatTokens(c.total_tokens)}</strong> ({c.count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Window + Filter */}
        <div className="px-6 pb-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                onClick={() => setHours(w.hours)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${hours === w.hours ? 'font-medium' : ''}`}
                style={hours === w.hours
                  ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }
                  : { color: 'var(--color-text-tertiary)' }
                }
              >
                {t(w.key)}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${filter === f.id ? 'font-medium' : ''}`}
                style={filter === f.id
                  ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }
                  : { color: 'var(--color-text-tertiary)' }
                }
              >
                {t(f.key)}
              </button>
            ))}
          </div>
        </div>

        {/* Card stack */}
        <div className="flex-1 overflow-y-auto px-6 pb-6" id="review-queue-stack">
          {loading && items.length === 0 ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Inbox size={48} style={{ color: 'var(--color-text-faint)' }} />
              <p className="mt-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {t('review.empty')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item, idx) => (
                <div key={item.id} data-focus-idx={idx} ref={idx === focusIdx ? scrollFocusedIntoView : null}>
                <ReviewCard
                  item={item}
                  focused={idx === focusIdx}
                  expanded={expandedId === item.id}
                  onFocus={() => setFocusIdx(idx)}
                  onToggleExpand={() => toggleExpand(item.id)}
                  onOpen={() => handleOpen(item)}
                  onApprove={() => handleApprove(item)}
                  onContinue={(p) => handleContinue(item, p)}
                  onDiscard={() => handleDiscard(item)}
                  busy={!!busyMap[item.id]}
                />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {openItem && (
        <div
          className="w-[480px] flex-shrink-0 flex flex-col border-l overflow-hidden animate-slide-in-right"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-primary)' }}
        >
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
            <div className="min-w-0">
              <div className="text-2xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {openItem.project_name}
              </div>
              <div className="font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                {openItem.title}
              </div>
            </div>
            <button
              onClick={() => setOpenItem(null)}
              className="btn-ghost p-1.5"
              title={t('review.closeDetails')}
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {openLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : (
              <LogViewer logs={openLogs} embedded />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

