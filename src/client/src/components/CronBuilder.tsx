import { useState, useEffect } from 'react';
import { useI18n, type TranslationKey } from '../i18n';

type CronMode = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

interface CronBuilderProps {
  value: string;
  onChange: (value: string) => void;
}

const WEEKDAYS: { value: number; labelKey: TranslationKey }[] = [
  { value: 1, labelKey: 'cron.mon' },
  { value: 2, labelKey: 'cron.tue' },
  { value: 3, labelKey: 'cron.wed' },
  { value: 4, labelKey: 'cron.thu' },
  { value: 5, labelKey: 'cron.fri' },
  { value: 6, labelKey: 'cron.sat' },
  { value: 0, labelKey: 'cron.sun' },
];

function parseCronToState(cron: string): {
  mode: CronMode;
  everyMinutes: number;
  hourlyMinute: number;
  dailyHour: number;
  dailyMinute: number;
  weeklyDays: number[];
  weeklyHour: number;
  weeklyMinute: number;
  monthlyDay: number;
  monthlyHour: number;
  monthlyMinute: number;
} {
  const defaults = {
    mode: 'daily' as CronMode,
    everyMinutes: 30,
    hourlyMinute: 0,
    dailyHour: 9,
    dailyMinute: 0,
    weeklyDays: [1, 2, 3, 4, 5],
    weeklyHour: 9,
    weeklyMinute: 0,
    monthlyDay: 1,
    monthlyHour: 9,
    monthlyMinute: 0,
  };

  if (!cron) return defaults;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...defaults, mode: 'custom' };

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  // Every N minutes: */N * * * *
  const everyMinMatch = minute.match(/^\*\/(\d+)$/);
  if (everyMinMatch && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return { ...defaults, mode: 'minutes', everyMinutes: parseInt(everyMinMatch[1]) };
  }

  // Hourly: M * * * *
  if (/^\d+$/.test(minute) && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return { ...defaults, mode: 'hourly', hourlyMinute: parseInt(minute) };
  }

  const min = /^\d+$/.test(minute) ? parseInt(minute) : -1;
  const hr = /^\d+$/.test(hour) ? parseInt(hour) : -1;

  if (min < 0 || hr < 0) return { ...defaults, mode: 'custom' };

  // Weekly: M H * * D,D,...
  if (dayOfMonth === '*' && dayOfWeek !== '*') {
    const days = dayOfWeek.split(',').map(d => {
      const n = parseInt(d);
      return isNaN(n) ? -1 : n;
    }).filter(n => n >= 0);
    if (days.length > 0) {
      return { ...defaults, mode: 'weekly', weeklyDays: days, weeklyHour: hr, weeklyMinute: min };
    }
  }

  // Monthly: M H D * *
  if (/^\d+$/.test(dayOfMonth) && dayOfWeek === '*') {
    return { ...defaults, mode: 'monthly', monthlyDay: parseInt(dayOfMonth), monthlyHour: hr, monthlyMinute: min };
  }

  // Daily: M H * * *
  if (dayOfMonth === '*' && dayOfWeek === '*') {
    return { ...defaults, mode: 'daily', dailyHour: hr, dailyMinute: min };
  }

  return { ...defaults, mode: 'custom' };
}

function buildCron(state: ReturnType<typeof parseCronToState>): string {
  switch (state.mode) {
    case 'minutes':
      return `*/${state.everyMinutes} * * * *`;
    case 'hourly':
      return `${state.hourlyMinute} * * * *`;
    case 'daily':
      return `${state.dailyMinute} ${state.dailyHour} * * *`;
    case 'weekly':
      return `${state.weeklyMinute} ${state.weeklyHour} * * ${state.weeklyDays.sort((a, b) => a - b).join(',')}`;
    case 'monthly':
      return `${state.monthlyMinute} ${state.monthlyHour} ${state.monthlyDay} * *`;
    default:
      return '';
  }
}

export default function CronBuilder({ value, onChange }: CronBuilderProps) {
  const { t } = useI18n();
  const [state, setState] = useState(() => parseCronToState(value));
  const [customValue, setCustomValue] = useState(value);

  // Sync generated cron expression to parent
  useEffect(() => {
    if (state.mode === 'custom') {
      onChange(customValue);
    } else {
      const cron = buildCron(state);
      onChange(cron);
    }
  }, [state, customValue]);

  const update = (patch: Partial<typeof state>) => {
    setState(prev => ({ ...prev, ...patch }));
  };

  const toggleWeekday = (day: number) => {
    setState(prev => {
      const days = prev.weeklyDays.includes(day)
        ? prev.weeklyDays.filter(d => d !== day)
        : [...prev.weeklyDays, day];
      return { ...prev, weeklyDays: days.length > 0 ? days : prev.weeklyDays };
    });
  };

  const modes: { value: CronMode; labelKey: TranslationKey }[] = [
    { value: 'minutes', labelKey: 'cron.everyMinutes' },
    { value: 'hourly', labelKey: 'cron.hourly' },
    { value: 'daily', labelKey: 'cron.daily' },
    { value: 'weekly', labelKey: 'cron.weekly' },
    { value: 'monthly', labelKey: 'cron.monthly' },
    { value: 'custom', labelKey: 'cron.custom' },
  ];

  const compactSelect = "bg-warm-50 border border-warm-300 rounded-lg px-2 py-1.5 text-sm text-warm-800 font-mono text-center transition-all duration-200 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

  const timeSelect = (hour: number, minute: number, onHourChange: (h: number) => void, onMinuteChange: (m: number) => void) => (
    <div className="flex items-center gap-1.5">
      <select
        value={hour}
        onChange={(e) => onHourChange(parseInt(e.target.value))}
        className={`${compactSelect} w-16`}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
        ))}
      </select>
      <span className="text-warm-500 font-mono">:</span>
      <select
        value={minute}
        onChange={(e) => onMinuteChange(parseInt(e.target.value))}
        className={`${compactSelect} w-16`}
      >
        {Array.from({ length: 12 }, (_, i) => i * 5).map(m => (
          <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
        ))}
      </select>
    </div>
  );

  const currentCron = state.mode === 'custom' ? customValue : buildCron(state);

  return (
    <div className="space-y-3">
      {/* Mode selector tabs */}
      <div className="flex flex-wrap gap-1.5">
        {modes.map(m => (
          <button
            key={m.value}
            type="button"
            onClick={() => update({ mode: m.value })}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              state.mode === m.value
                ? 'bg-amber-500 text-white'
                : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>

      {/* Mode-specific controls */}
      <div className="bg-warm-50 rounded-lg p-3">
        {state.mode === 'minutes' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-warm-600">{t('cron.every')}</span>
            <select
              value={state.everyMinutes}
              onChange={(e) => update({ everyMinutes: parseInt(e.target.value) })}
              className={`${compactSelect} w-20`}
            >
              {[5, 10, 15, 20, 30].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <span className="text-sm text-warm-600">{t('cron.minutesLabel')}</span>
          </div>
        )}

        {state.mode === 'hourly' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-warm-600">{t('cron.everyHourAt')}</span>
            <select
              value={state.hourlyMinute}
              onChange={(e) => update({ hourlyMinute: parseInt(e.target.value) })}
              className={`${compactSelect} w-16`}
            >
              {Array.from({ length: 12 }, (_, i) => i * 5).map(m => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
            <span className="text-sm text-warm-600">{t('cron.minutesPast')}</span>
          </div>
        )}

        {state.mode === 'daily' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-warm-600">{t('cron.everyDayAt')}</span>
            {timeSelect(
              state.dailyHour, state.dailyMinute,
              (h) => update({ dailyHour: h }),
              (m) => update({ dailyMinute: m })
            )}
          </div>
        )}

        {state.mode === 'weekly' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map(day => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleWeekday(day.value)}
                  className={`w-9 h-9 rounded-lg text-xs font-medium transition-colors ${
                    state.weeklyDays.includes(day.value)
                      ? 'bg-amber-500 text-white'
                      : 'bg-theme-card text-warm-500 border border-warm-200 hover:border-amber-300'
                  }`}
                >
                  {t(day.labelKey)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-warm-600">{t('cron.at')}</span>
              {timeSelect(
                state.weeklyHour, state.weeklyMinute,
                (h) => update({ weeklyHour: h }),
                (m) => update({ weeklyMinute: m })
              )}
            </div>
          </div>
        )}

        {state.mode === 'monthly' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-warm-600">{t('cron.everyMonthOn')}</span>
            <select
              value={state.monthlyDay}
              onChange={(e) => update({ monthlyDay: parseInt(e.target.value) })}
              className={`${compactSelect} w-16`}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <span className="text-sm text-warm-600">{t('cron.dayAt')}</span>
            {timeSelect(
              state.monthlyHour, state.monthlyMinute,
              (h) => update({ monthlyHour: h }),
              (m) => update({ monthlyMinute: m })
            )}
          </div>
        )}

        {state.mode === 'custom' && (
          <div>
            <input
              type="text"
              placeholder="*/30 * * * *"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="bg-warm-50 border border-warm-300 rounded-lg px-3 py-1.5 w-full text-sm text-warm-800 font-mono transition-all duration-200 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-2xs text-warm-400 mt-1">
              {t('schedule.cronHint')}
            </p>
          </div>
        )}
      </div>

      {/* Preview */}
      {state.mode !== 'custom' && currentCron && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-warm-400">{t('cron.expression')}:</span>
          <code className="px-2 py-0.5 rounded bg-warm-100 text-warm-600 font-mono">{currentCron}</code>
        </div>
      )}
    </div>
  );
}
