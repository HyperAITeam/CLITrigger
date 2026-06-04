import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ymd, type CalView, type CalChip, type CalBar } from './calendarShared';

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
  // Multi-day spanning bars (month view only). Drawn as an overlay per week.
  bars?: CalBar[];
  onBarClick?: (bar: CalBar) => void;
  // Month-view cell min-height (px). User-resizable; defaults to the original
  // fixed height when the caller doesn't manage it.
  monthCellHeight?: number;
}

const EXPAND_DELAY_MS = 420;   // hover dwell before a crowded day expands
const EXPAND_CLOSE_MS = 140;   // grace so the cursor can travel into the popover
const EXPAND_MIN_W = 220;

// Spanning-bar layout constants (px).
const BAR_TOP = 26;  // first lane sits just below the date number
const BAR_H = 16;
const BAR_GAP = 2;

interface PlacedSeg { bar: CalBar; startCol: number; endCol: number; lane: number; contStart: boolean; contEnd: boolean; }

// Clip each bar to this week, then stack overlapping segments into lanes.
// Lanes are assigned per-week independently (a 3-week bar may sit on different
// lanes each week) — the standard month-calendar approach.
function layoutWeekBars(weekDays: Date[], bars: CalBar[]): { placed: PlacedSeg[]; laneCount: number } {
  if (!bars.length) return { placed: [], laneCount: 0 };
  const weekStart = ymd(weekDays[0]);
  const weekEnd = ymd(weekDays[weekDays.length - 1]);
  const segs = bars
    .filter((b) => b.startKey <= weekEnd && b.endKey >= weekStart)
    .map((b) => {
      const sKey = b.startKey < weekStart ? weekStart : b.startKey;
      const eKey = b.endKey > weekEnd ? weekEnd : b.endKey;
      return {
        bar: b,
        startCol: weekDays.findIndex((d) => ymd(d) === sKey),
        endCol: weekDays.findIndex((d) => ymd(d) === eKey),
        contStart: b.startKey < weekStart,
        contEnd: b.endKey > weekEnd,
      };
    })
    .filter((s) => s.startCol >= 0 && s.endCol >= 0)
    .sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));
  const laneEnds: number[] = []; // last occupied endCol per lane
  const placed: PlacedSeg[] = segs.map((seg) => {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= seg.startCol) lane++;
    laneEnds[lane] = seg.endCol;
    return { ...seg, lane };
  });
  return { placed, laneCount: laneEnds.length };
}

// Presentational month/week/day grid. Data-source agnostic: the caller buckets
// its entries into `chipsByDay` and handles clicks via `onChipClick`.
export default function CalendarGrid({
  view, gridDays, cols, dimOutOfMonth, monthIdx, todayKey, selectedDate,
  chipsByDay, maxChips, weekdayLabels, addItemLabel, bars, onBarClick,
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

  // One day cell. `reserveTop` is the height (px) reserved at the top for the
  // week's spanning bars so chips/date never overlap them (0 in week/day view).
  const renderCell = (d: Date, reserveTop: number) => {
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
          minHeight: view === 'month' ? monthCellHeight + reserveTop : undefined,
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
        <div className="flex flex-col gap-0.5 overflow-hidden" style={{ marginTop: reserveTop || undefined }}>
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
  };

  // Month view chunks gridDays into weeks so spanning bars can overlay each
  // week row; week/day keep the original flat grid (no bars).
  const weeks: Date[][] = [];
  if (view === 'month') {
    for (let i = 0; i < gridDays.length; i += cols) weeks.push(gridDays.slice(i, i + cols));
  }

  return (
    <>
      {(view === 'month' || view === 'week') && (
        <div className="grid gap-px text-2xs uppercase tracking-wider mb-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, color: 'var(--color-text-muted)' }}>
          {weekdayLabels.map((w) => (<div key={w} className="px-2 py-1">{w}</div>))}
        </div>
      )}

      {view === 'month' ? (
        <div className="flex flex-col gap-px rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
          {weeks.map((week, wi) => {
            const { placed, laneCount } = layoutWeekBars(week, bars ?? []);
            const reserve = laneCount * (BAR_H + BAR_GAP);
            return (
              <div
                key={wi}
                className="relative grid gap-px"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, backgroundColor: 'var(--color-border)' }}
              >
                {week.map((d) => renderCell(d, reserve))}
                {/* Spanning-bar overlay for this week. */}
                {placed.map(({ bar, startCol, endCol, lane, contStart, contEnd }) => (
                  <div
                    key={bar.key}
                    onClick={(ev) => { ev.stopPropagation(); onBarClick?.(bar); }}
                    className="absolute text-2xs truncate px-1.5 cursor-pointer hover:opacity-80 transition-opacity flex items-center"
                    style={{
                      left: `calc(${startCol} / ${cols} * 100% + 2px)`,
                      width: `calc(${endCol - startCol + 1} / ${cols} * 100% - 4px)`,
                      top: BAR_TOP + lane * (BAR_H + BAR_GAP),
                      height: BAR_H,
                      backgroundColor: bar.bg,
                      color: bar.fg,
                      textDecoration: bar.done ? 'line-through' : 'none',
                      borderRadius: 4,
                      borderTopLeftRadius: contStart ? 0 : 4,
                      borderBottomLeftRadius: contStart ? 0 : 4,
                      borderTopRightRadius: contEnd ? 0 : 4,
                      borderBottomRightRadius: contEnd ? 0 : 4,
                    }}
                    title={bar.title}
                  >
                    {contStart ? '◀ ' : ''}{bar.title}{contEnd ? ' ▶' : ''}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="grid gap-px rounded-xl overflow-hidden"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, backgroundColor: 'var(--color-border)' }}
        >
          {gridDays.map((d) => renderCell(d, 0))}
        </div>
      )}

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
