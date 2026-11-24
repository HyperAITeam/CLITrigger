import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getCliUsage, type UsageSnapshot, type UsageWindow } from '../api/cli-status';
import { useI18n } from '../i18n';
import IconButton from './IconButton';

// Plan usage only moves a few % per hour and the server caches it 5 min, so
// poll rarely; the widget owns its state so a refresh re-renders only itself.
const REFRESH_MS = 5 * 60_000;

function Meter({ label, window }: { label: string; window: UsageWindow | null }) {
  const { t } = useI18n();
  if (!window) return null;
  const percent = window.resetsAt * 1000 < Date.now() ? 0 : Math.min(100, window.percent);
  const fill = percent >= 95 ? 'bg-status-error' : percent >= 80 ? 'bg-status-warning' : 'bg-theme-accent';
  return (
    <span className="flex items-center gap-1.5" title={`${t('usage.resetsAt')} ${new Date(window.resetsAt * 1000).toLocaleString()}`}>
      <span className="text-theme-muted">{label}</span>
      <span className="w-10 h-1 rounded-full bg-theme-bg-tertiary overflow-hidden">
        <span className={`block h-full ${fill}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="w-8 text-right tabular-nums">{percent}%</span>
    </span>
  );
}

export default function CliUsageWidget() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  // force: mount (panel/workspace switch) and the button skip the server's
  // 5-min cache; the background timer doesn't.
  const load = (force: boolean) => {
    setLoading(true);
    getCliUsage(force).then(setUsage).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const rows = usage
    ? ([['Claude', usage.claude], ['Codex', usage.codex]] as const).flatMap(([name, cli]) => (cli ? [{ name, cli }] : []))
    : [];
  if (!rows.length) return null;

  return (
    <div className="hidden md:flex items-center gap-2 fixed bottom-2 right-3 z-10 pl-3 pr-1.5 py-2 rounded-lg border border-theme-border bg-theme-card shadow-card text-xs text-theme-text">
      <div className="space-y-1">
        {rows.map(({ name, cli }) => (
          <div key={name} className="flex items-center gap-3" title={`${t('usage.updatedAt')} ${new Date(cli.updatedAt).toLocaleString()}`}>
            <span className="w-12 font-medium">{name}</span>
            <Meter label={t('usage.fiveHour')} window={cli.fiveHour} />
            <Meter label={t('usage.weekly')} window={cli.weekly} />
          </div>
        ))}
      </div>
      <IconButton size="sm" label={t('usage.refresh')} onClick={() => load(true)} disabled={loading}>
        <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
      </IconButton>
    </div>
  );
}
