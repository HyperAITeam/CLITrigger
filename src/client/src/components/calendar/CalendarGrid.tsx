import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  // Month-view cell min-height (px). User-resizable; defaults to the original
  // fixed height when the caller doesn't manage it.
  monthCellHeight?: number;
}

const EXPAND_DELAY_MS = 420;   // hover dwell before a crowded day expands
const EXPAND_CLOSE_MS = 140;   // grace so the cursor can travel into the popover
const EXPAND_MIN_W = 220;

// Presentational month/week/day grid. Data-source agnostic: the caller buckets
// its entries into `chipsByDay` and handles clicks via `onChipClick`.
export default function CalendarGrid({
  view, gridDays, cols, dimOutOfMonth, monthIdx, todayKey, selectedDate,
  chipsByDay, maxChips, weekdayLabels, addItemLabel,
  onSelectDate, onQuickAdd, onChipClick, monthCellHeight = 92,
}: CalendarGridProps) {
  // Hover-to-expand: when a month cell hides entries behind "+N", dwelling on
  // it pops a portal card showing the whole day, with a small scale-in.
  const [expanded, setExpanded] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [expVisible, setExpVisible] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleOpen = (key: string, el: HTMLElement) => {
    cancelClose();
    if (openTimer.current) clearTimeout(openTimer.current);
    const rect = el.getBoundingClientRect();
    openTimer.current = window.setTimeout(() => setExpanded({ key, rect }), EXPAND_DELAY_MS);
  };
  const scheduleClose = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    closeTimer.current = window.setTimeout(() => setExpanded(null), EXPAND_CLOSE_MS);
  };

  // Animate in on mount; tear timers down on unmount.
  useEffect(() => {
    if (!expanded) { setExpVisible(false); return; }
    const id = requestAnimationFrame(() => setExpVisible(true));
    return () => cancelAnimationFrame(id);
  }, [expanded]);
  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  // Scrolling/resizing invalidates the anchor rect — just close.
  useEffect(() => {
    if (!expanded) return;
    const close = () => setExpanded(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [expanded]);

  const expEntries = expanded ? (chipsByDay.get(expanded.key) ?? []) : [];

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
          const cellMin = view === 'week' ? 'min-h-[360px]' : view === 'day' ? 'min-h-[480px]' : '';
          const hasOverflow = view === 'month' && entries.length > maxChips;
          return (
            <div
              key={key}
              onClick={() => onSelectDate(key)}
              onMouseEnter={hasOverflow ? (e) => scheduleOpen(key, e.currentTarget) : undefined}
              onMouseLeave={hasOverflow ? scheduleClose : undefined}
              className={`group relative ${cellMin} text-left p-1.5 flex flex-col gap-1 transition-colors cursor-pointer`}
              style={{
                minHeight: view === 'month' ? monthCellHeight : undefined,
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

      {/* Hover-expanded day: portal card with the full entry list. */}
      {expanded && (() => {
        const w = Math.max(expanded.rect.width, EXPAND_MIN_W);
        const left = Math.min(Math.max(8, expanded.rect.left), window.innerWidth - w - 8);
        const top = Math.max(8, Math.min(expanded.rect.top, window.innerHeight - 120));
        const maxHeight = window.innerHeight - top - 16;
        const dayNum = Number(expanded.key.slice(8, 10));
        return createPortal(
          <div
            className="z-tooltip rounded-lg shadow-xl"
            onMouseEnter={cancelClose}
            onMouseLeave={() => setExpanded(null)}
            style={{
              position: 'fixed', left, top, width: w, maxHeight, overflowY: 'auto',
              backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
              padding: 6, transformOrigin: 'top left',
              transform: expVisible ? 'scale(1)' : 'scale(0.96)',
              opacity: expVisible ? 1 : 0,
              transition: 'transform 140ms ease, opacity 140ms ease',
            }}
          >
            <div className="text-xs font-semibold px-1 pb-1" style={{ color: 'var(--color-text-secondary)' }}>{dayNum}</div>
            <div className="flex flex-col gap-0.5">
              {expEntries.map((chip) => (
                <span
                  key={chip.key}
                  onClick={(ev) => { ev.stopPropagation(); onChipClick(chip); setExpanded(null); }}
                  className="text-2xs truncate px-1 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ backgroundColor: chip.bg, color: chip.fg, textDecoration: chip.done ? 'line-through' : 'none' }}
                  title={chip.title}
                >
                  {chip.prefix ?? ''}{chip.time ? `${chip.time} ` : ''}{chip.title}
                </span>
              ))}
            </div>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}
