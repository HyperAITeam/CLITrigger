import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { Skeleton } from './Skeleton';
import * as analyticsApi from '../api/analytics';
import type { AnalyticsData } from '../api/analytics';

interface AnalyticsPanelProps {
  projectId: string;
}

const PERIODS = ['7d', '30d', '90d', 'all'] as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--color-status-success)',
  merged: 'var(--color-accent)',
  failed: 'var(--color-status-error)',
  stopped: 'var(--color-status-warning)',
  running: 'var(--color-status-info)',
};

export default function AnalyticsPanel({ projectId }: AnalyticsPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [period, setPeriod] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    analyticsApi.getAnalytics(projectId, period)
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [projectId, period]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-1">
            <Skeleton className="h-6 w-12" count={4} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-3 space-y-2">
              <Skeleton className="h-6 w-16 mx-auto" />
              <Skeleton className="h-3 w-12 mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4 space-y-3">
            <Skeleton className="h-3 w-24 mb-4" />
            <Skeleton className="h-4 w-full" count={4} />
          </div>
          <div className="card p-4 space-y-3">
            <Skeleton className="h-3 w-24 mb-4" />
            <Skeleton className="h-4 w-full" count={4} />
          </div>
        </div>
        <div className="card p-4 space-y-3">
          <Skeleton className="h-3 w-24 mb-4" />
          <div className="flex items-end gap-1 h-32">
            {[...Array(20)].map((_, i) => (
              <Skeleton key={i} className="flex-1" height={`${Math.random() * 100}%`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-status-error">{error}</div>;
  }

  if (!data) return null;

  const { summary, byCliTool, byDate, byStatus } = data;
  const maxDailyCount = Math.max(...byDate.map(d => d.count), 1);
  const maxDailyCost = Math.max(...byDate.map(d => d.costUsd), 0.01);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          {t('analytics.title')}
        </h3>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                period === p
                  ? 'bg-accent text-white'
                  : 'hover:bg-theme-hover'
              }`}
              style={period !== p ? { color: 'var(--color-text-muted)' } : undefined}
            >
              {t(`analytics.period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label={t('analytics.totalTasks')} value={String(summary.totalTasks)} />
        <SummaryCard label={t('analytics.successRate')} value={`${summary.successRate}%`} color={summary.successRate >= 70 ? 'var(--color-status-success)' : summary.successRate >= 40 ? 'var(--color-status-warning)' : 'var(--color-status-error)'} />
        <SummaryCard label={t('analytics.totalCost')} value={formatCost(summary.totalCostUsd)} />
        <SummaryCard label={t('analytics.totalTokens')} value={formatTokens(summary.totalTokens)} />
      </div>

      {/* Status breakdown + CLI tool stats row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status breakdown */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('analytics.byStatus')}
          </h4>
          {byStatus.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('analytics.noData')}</p>
          ) : (
            <div className="space-y-2">
              {byStatus.map((s) => (
                <div key={s.status} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[s.status] || 'var(--color-text-muted)' }} />
                  <span className="text-xs flex-1 capitalize">{s.status}</span>
                  <span className="text-xs font-mono font-medium">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CLI tool stats */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('analytics.byCliTool')}
          </h4>
          {byCliTool.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('analytics.noData')}</p>
          ) : (
            <div className="space-y-3">
              {byCliTool.map((tool) => {
                const maxCount = Math.max(...byCliTool.map(t => t.count), 1);
                return (
                  <div key={tool.cli_tool}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium capitalize">{tool.cli_tool}</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                        {tool.count} {t('analytics.tasks')} &middot; {tool.successRate}% &middot; {formatCost(tool.totalCostUsd)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(tool.count / maxCount) * 100}%`,
                          backgroundColor: 'var(--color-accent)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Daily chart */}
      {byDate.length > 0 && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('analytics.dailyActivity')}
          </h4>
          <div className="flex items-end gap-[2px] h-32" style={{ minHeight: '128px' }}>
            {byDate.map((day) => {
              const completedHeight = (day.completed / maxDailyCount) * 100;
              const failedHeight = (day.failed / maxDailyCount) * 100;
              const otherHeight = ((day.count - day.completed - day.failed) / maxDailyCount) * 100;
              return (
                <div
                  key={day.date}
                  className="flex-1 flex flex-col justify-end gap-[1px] group relative"
                  style={{ minWidth: '4px', maxWidth: '32px' }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <div className="card px-2 py-1 text-[10px] whitespace-nowrap shadow-lg" style={{ color: 'var(--color-text-secondary)' }}>
                      <div className="font-medium">{day.date}</div>
                      <div>{day.count} {t('analytics.tasks')} &middot; {formatCost(day.costUsd)}</div>
                    </div>
                  </div>
                  {otherHeight > 0 && (
                    <div className="rounded-t-sm" style={{ height: `${otherHeight}%`, backgroundColor: 'var(--color-text-muted)', opacity: 0.4, minHeight: '2px' }} />
                  )}
                  {failedHeight > 0 && (
                    <div className="rounded-sm" style={{ height: `${failedHeight}%`, backgroundColor: 'var(--color-status-error)', minHeight: '2px' }} />
                  )}
                  {completedHeight > 0 && (
                    <div className="rounded-b-sm" style={{ height: `${completedHeight}%`, backgroundColor: 'var(--color-status-success)', minHeight: '2px' }} />
                  )}
                </div>
              );
            })}
          </div>
          {/* Date labels */}
          <div className="flex justify-between mt-1">
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{byDate[0]?.date}</span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{byDate[byDate.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Cost chart */}
      {byDate.length > 0 && byDate.some(d => d.costUsd > 0) && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('analytics.dailyCost')}
          </h4>
          <div className="flex items-end gap-[2px] h-24">
            {byDate.map((day) => (
              <div
                key={day.date}
                className="flex-1 group relative"
                style={{ minWidth: '4px', maxWidth: '32px' }}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                  <div className="card px-2 py-1 text-[10px] whitespace-nowrap shadow-lg" style={{ color: 'var(--color-text-secondary)' }}>
                    <div className="font-medium">{day.date}</div>
                    <div>{formatCost(day.costUsd)} &middot; {formatTokens(day.tokens)}</div>
                  </div>
                </div>
                <div
                  className="rounded-sm w-full"
                  style={{
                    height: `${(day.costUsd / maxDailyCost) * 100}%`,
                    backgroundColor: 'var(--color-accent)',
                    minHeight: day.costUsd > 0 ? '2px' : '0px',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{byDate[0]?.date}</span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{byDate[byDate.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Avg cost per task */}
      {summary.totalTasks > 0 && summary.totalCostUsd > 0 && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('analytics.costBreakdown')}
          </h4>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>{formatCost(summary.totalCostUsd)}</div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{t('analytics.totalCost')}</div>
            </div>
            <div>
              <div className="text-lg font-bold">{formatCost(summary.avgCostPerTask)}</div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{t('analytics.avgPerTask')}</div>
            </div>
            <div>
              <div className="text-lg font-bold">{formatTokens(summary.totalTokens)}</div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{t('analytics.totalTokens')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-xl font-bold" style={color ? { color } : undefined}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  );
}
