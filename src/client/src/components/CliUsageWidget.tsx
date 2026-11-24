import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getCliUsage, type UsageSnapshot, type UsageWindow } from '../api/cli-status';
import { useI18n } from '../i18n';
import IconButton from './IconButton';

// Plan usage only moves a few % per hour and the server caches it 5 min, so
// poll rarely; the widget owns its state so a refresh re-renders only itself.
const REFRESH_MS = 5 * 60_000;

// "17:30" when under a day away, else with the weekday ("Sat 09:00") — a
// weekly window ends at most 7 days out, so the weekday alone is unambiguous.
function formatReset(resetsAtMs: number, lang: string): string {
  const withinDay = resetsAtMs - Date.now() < 24 * 3_600_000;
  return new Date(resetsAtMs).toLocaleString(lang, { weekday: withinDay ? undefined : 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function Meter({ label, window }: { label: string; window: UsageWindow | null }) {
  const { t, lang } = useI18n();
  if (!window) return <span />; // keeps the other meters in their grid column
  const resetsAtMs = window.resetsAt * 1000;
  // Past its reset the window reads 0% and has no next reset until it is used again.
  const expired = resetsAtMs < Date.now();
  const percent = expired ? 0 : Math.min(100, window.percent);
  const fill = percent >= 95 ? 'bg-status-error' : percent >= 80 ? 'bg-status-warning' : 'bg-theme-accent';
  return (
    <span className="flex items-center gap-1.5" title={`${t('usage.resetsAt')} ${new Date(resetsAtMs).toLocaleString()}`}>
      <span className="text-theme-muted">{label}</span>
      <span className="w-10 h-1 rounded-full bg-theme-bg-tertiary overflow-hidden">
        <span className={`block h-full ${fill}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="w-8 text-right tabular-nums">{percent}%</span>
      {!expired && (
        <span className="text-theme-muted tabular-nums">{t('usage.resetsAtShort').replace('{time}', formatReset(resetsAtMs, lang))}</span>
      )}
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
    // Settings → 터미널 toggle: the server answers empty while off, so a reload hides/shows it.
    const onToggle = () => load(true);
    window.addEventListener('usage-widget:changed', onToggle);
    return () => {
      clearInterval(timer);
      window.removeEventListener('usage-widget:changed', onToggle);
    };
  }, []);

  const rows = usage
    ? ([['Claude', usage.claude], ['Codex', usage.codex]] as const).flatMap(([name, cli]) => (cli ? [{ name, cli }] : []))
    : [];
  if (!rows.length) return null;

  return (
    <div className="hidden md:flex items-center gap-2 fixed bottom-2 right-3 z-10 pl-3 pr-1.5 py-2 rounded-lg border border-theme-border bg-theme-card shadow-card text-xs text-theme-text">
      {/* Grid, not per-row flex: the reset texts vary in width and the columns must still line up. */}
      <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1">
        {rows.map(({ name, cli }) => (
          <div key={name} className="contents" title={`${t('usage.updatedAt')} ${new Date(cli.updatedAt).toLocaleString()}`}>
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
