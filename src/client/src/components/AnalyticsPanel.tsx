import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { Skeleton } from './Skeleton';
import * as analyticsApi from '../api/analytics';
import type { AnalyticsData } from '../api/analytics';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
  LineChart, Line, CartesianGrid,
  type TooltipProps,
} from 'recharts';

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
  completed: '#34C759',
  merged: 'var(--color-accent)',
  failed: '#FF3B30',
  stopped: '#FF9500',
  running: '#007AFF',
};

const PIE_COLORS = ['#34C759', '#4B8DFF', '#FF3B30', '#FF9500', '#007AFF', '#AF52DE'];

// Custom tooltip styled with theme
function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-elevated border-theme-border">
      {label && <div className="font-medium text-theme-text mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-theme-text-secondary">
          {p.color && <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: p.color }} />}
          <span>{p.name}: </span>
          <span className="font-medium text-theme-text">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function CostTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-elevated border-theme-border">
      {label && <div className="font-medium text-theme-text mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-theme-text-secondary">
          {p.color && <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: p.color }} />}
          <span>{p.name}: </span>
          <span className="font-medium text-theme-text">{typeof p.value === 'number' ? formatCost(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function TokenTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-elevated border-theme-border">
      {label && <div className="font-medium text-theme-text mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-theme-text-secondary">
          {p.color && <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: p.color }} />}
          <span>{p.name}: </span>
          <span className="font-medium text-theme-text">{typeof p.value === 'number' ? formatTokens(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPanel({ projectId }: AnalyticsPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [period, setPeriod] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<'cost' | 'tokens'>('cost');

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
        <div className="card p-4 space-y-3">
          <Skeleton className="h-3 w-24 mb-4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-status-error">{error}</div>;
  }

  if (!data) return null;

  const { summary, byCliTool, byDate, byStatus } = data;

  // Prepare chart data
  const barData = byDate.map(d => ({
    date: d.date.slice(5), // MM-DD
    completed: d.completed,
    failed: d.failed,
    other: Math.max(0, d.count - d.completed - d.failed),
    cost: d.costUsd,
    tokens: d.tokens,
  }));

  const pieData = byStatus.map((s, i) => ({
    name: s.status,
    value: s.count,
    color: STATUS_COLORS[s.status] || PIE_COLORS[i % PIE_COLORS.length],
  }));

  const axisStyle = { fontSize: 10, fill: 'var(--color-text-muted)' };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-theme-muted">
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
                  : 'hover:bg-theme-hover text-theme-muted'
              }`}
            >
              {t(`analytics.period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label={t('analytics.totalTasks')} value={String(summary.totalTasks)} />
        <SummaryCard label={t('analytics.successRate')} value={`${summary.successRate}%`} color={summary.successRate >= 70 ? '#34C759' : summary.successRate >= 40 ? '#FF9500' : '#FF3B30'} />
        <SummaryCard label={t('analytics.totalCost')} value={formatCost(summary.totalCostUsd)} />
        <SummaryCard label={t('analytics.totalTokens')} value={formatTokens(summary.totalTokens)} />
      </div>

      {/* Status donut + CLI tool stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status distribution — donut chart */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 text-theme-muted">
            {t('analytics.byStatus')}
          </h4>
          {pieData.length === 0 ? (
            <p className="text-xs text-theme-muted">{t('analytics.noData')}</p>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={28}
                    outerRadius={45}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 flex-1">
                {pieData.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-xs flex-1 capitalize">{s.name}</span>
                    <span className="text-xs font-mono font-medium">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CLI tool stats */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 text-theme-muted">
            {t('analytics.byCliTool')}
          </h4>
          {byCliTool.length === 0 ? (
            <p className="text-xs text-theme-muted">{t('analytics.noData')}</p>
          ) : (
            <div className="space-y-3">
              {byCliTool.map((tool) => {
                const maxCount = Math.max(...byCliTool.map(t => t.count), 1);
                return (
                  <div key={tool.cli_tool}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium capitalize">{tool.cli_tool}</span>
                      <span className="text-2xs font-mono text-theme-muted">
                        {tool.count} {t('analytics.tasks')} &middot; {tool.successRate}% &middot; {formatCost(tool.totalCostUsd)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-theme-bg-tertiary">
                      <div
                        className="h-full rounded-full transition-all bg-accent"
                        style={{ width: `${(tool.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Daily activity bar chart */}
      {barData.length > 0 && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 text-theme-muted">
            {t('analytics.dailyActivity')}
          </h4>
          <ResponsiveContainer width="100%" height={128}>
            <BarChart data={barData} barSize={6} barCategoryGap="30%">
              <XAxis
                dataKey="date"
                tick={axisStyle}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-bg-hover)', radius: 4 }} />
              <Bar dataKey="completed" stackId="a" fill="#34C759" name={t('analytics.completed') || 'Completed'} radius={[0, 0, 0, 0]} />
              <Bar dataKey="failed" stackId="a" fill="#FF3B30" name={t('analytics.failed') || 'Failed'} />
              <Bar dataKey="other" stackId="a" fill="var(--color-text-muted)" name={t('analytics.other') || 'Other'} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cost / Token line chart with tab toggle */}
      {barData.length > 0 && (barData.some(d => d.cost > 0) || barData.some(d => d.tokens > 0)) && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-muted">
              {activeChart === 'cost' ? t('analytics.dailyCost') : t('analytics.tokenTrend') || 'Token Trend'}
            </h4>
            <div className="flex gap-1">
              <button
                onClick={() => setActiveChart('cost')}
                className={`px-2 py-0.5 text-2xs rounded font-medium transition-colors ${activeChart === 'cost' ? 'bg-accent text-white' : 'text-theme-muted hover:bg-theme-hover'}`}
              >
                {t('analytics.cost') || 'Cost'}
              </button>
              <button
                onClick={() => setActiveChart('tokens')}
                className={`px-2 py-0.5 text-2xs rounded font-medium transition-colors ${activeChart === 'tokens' ? 'bg-accent text-white' : 'text-theme-muted hover:bg-theme-hover'}`}
              >
                {t('analytics.tokens') || 'Tokens'}
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={96}>
            <LineChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={axisStyle}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={axisStyle}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={activeChart === 'tokens' ? formatTokens : (v) => `$${v.toFixed(2)}`}
              />
              {activeChart === 'cost' ? (
                <Tooltip content={<CostTooltip />} />
              ) : (
                <Tooltip content={<TokenTooltip />} />
              )}
              <Line
                type="monotone"
                dataKey={activeChart}
                stroke="var(--color-accent)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: 'var(--color-accent)' }}
                name={activeChart === 'cost' ? (t('analytics.cost') || 'Cost') : (t('analytics.tokens') || 'Tokens')}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cost breakdown */}
      {summary.totalTasks > 0 && summary.totalCostUsd > 0 && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-3 text-theme-muted">
            {t('analytics.costBreakdown')}
          </h4>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-theme-accent">{formatCost(summary.totalCostUsd)}</div>
              <div className="text-2xs uppercase tracking-wider text-theme-muted">{t('analytics.totalCost')}</div>
            </div>
            <div>
              <div className="text-lg font-bold">{formatCost(summary.avgCostPerTask)}</div>
              <div className="text-2xs uppercase tracking-wider text-theme-muted">{t('analytics.avgPerTask')}</div>
            </div>
            <div>
              <div className="text-lg font-bold">{formatTokens(summary.totalTokens)}</div>
              <div className="text-2xs uppercase tracking-wider text-theme-muted">{t('analytics.totalTokens')}</div>
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
      <div className="text-2xs uppercase tracking-wider mt-0.5 text-theme-muted">{label}</div>
    </div>
  );
}
