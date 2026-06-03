import { Plus } from 'lucide-react';
import { ymd, type CalView, type CalChip } from './calendarShared';

interface CalendarGridProps {
  view: CalView; // 'month' | 'week' | 'day' — callers guard 'table' themselves
  gridDays: Date[];
  cols: number;
  dimOutOfMonth: boolean;
  monthIdx: number;
  todayKey: string;
  selectedDate: string;
  chipsByDay: Map<string, CalChip[]>;
  maxChips: number;
  weekdayLabels: string[];
  addItemLabel: string;
  onSelectDate: (key: string) => void;
  onQuickAdd: (key: string) => void;
  onChipClick: (chip: CalChip) => void;
}

// Presentational month/week/day grid. Data-source agnostic: the caller buckets
// its entries into `chipsByDay` and handles clicks via `onChipClick`.
export default function CalendarGrid({
  view, gridDays, cols, dimOutOfMonth, monthIdx, todayKey, selectedDate,
  chipsByDay, maxChips, weekdayLabels, addItemLabel,
  onSelectDate, onQuickAdd, onChipClick,
}: CalendarGridProps) {
  return (
    <>
      {(view === 'month' || view === 'week') && (
        <div className="grid gap-px text-2xs uppercase tracking-wider mb-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, color: 'var(--color-text-muted)' }}>
          {weekdayLabels.map((w) => (<div key={w} className="px-2 py-1">{w}</div>))}
        </div>
      )}
      <div
        className="grid gap-px rounded-xl overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, backgroundColor: 'var(--color-border)' }}
      >
        {gridDays.map((d) => {
          const key = ymd(d);
          const entries = chipsByDay.get(key) ?? [];
          const inMonth = !dimOutOfMonth || d.getMonth() === monthIdx;
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          const cellMin = view === 'month' ? 'min-h-[92px]' : view === 'week' ? 'min-h-[360px]' : 'min-h-[480px]';
          return (
            <div
              key={key}
              onClick={() => onSelectDate(key)}
              className={`group relative ${cellMin} text-left p-1.5 flex flex-col gap-1 transition-colors cursor-pointer`}
              style={{
                backgroundColor: isSelected ? 'var(--color-bg-hover)' : 'var(--color-bg-card)',
                opacity: inMonth ? 1 : 0.45,
              }}
            >
              <span className="flex items-center gap-1.5">
                {view !== 'month' && (
                  <span className="text-2xs uppercase" style={{ color: 'var(--color-text-muted)' }}>
                    {d.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                )}
                <span
                  className="text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full"
                  style={isToday
                    ? { backgroundColor: 'var(--color-accent)', color: '#fff' }
                    : { color: 'var(--color-text-secondary)' }}
                >
                  {d.getDate()}
                </span>
              </span>
              {/* Quick-add on this day (Notion-style): hover the cell to reveal a
                  "+" that opens the form with this date pre-filled. */}
              <button
                onClick={(ev) => { ev.stopPropagation(); onQuickAdd(key); }}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-md w-5 h-5 flex items-center justify-center hover:bg-theme-hover"
                title={addItemLabel}
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                <Plus size={13} />
              </button>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {entries.slice(0, maxChips).map((chip) => (
                  <span
                    key={chip.key}
                    onClick={(ev) => { ev.stopPropagation(); onChipClick(chip); }}
                    className="text-2xs truncate px-1 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                    style={{
                      backgroundColor: chip.bg,
                      color: chip.fg,
                      textDecoration: chip.done ? 'line-through' : 'none',
                    }}
                    title={chip.title}
                  >
                    {chip.prefix ?? ''}{chip.time ? `${chip.time} ` : ''}{chip.title}
                  </span>
                ))}
                {entries.length > maxChips && (
                  <span className="text-2xs px-1" style={{ color: 'var(--color-text-muted)' }}>+{entries.length - maxChips}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
