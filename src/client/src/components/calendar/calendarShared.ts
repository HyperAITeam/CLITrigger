import { useMemo } from 'react';
import { useI18n } from '../../i18n';

// Shared calendar primitives used by both "My Schedule" (PersonalAgenda) and a
// project's Planner calendar. Keeping the date math + range computation here
// guarantees the two calendars stay visually and behaviourally identical.

export type CalView = 'month' | 'week' | 'day' | 'table';

// ── date helpers ───────────────────────────────────────────────────────────
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Local/date strings (personal due_at, planner due_date) → slice; a full UTC
// ISO (schedule .at) → convert through Date to the local day.
export function dayKeyLocalIso(iso: string): string {
  return ymd(new Date(iso));
}
export function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function dayOnly(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function addDays(d: Date, n: number): Date { const x = dayOnly(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d: Date): Date { return addDays(d, -d.getDay()); }

// Whole-day difference between two YYYY-MM-DD keys (bKey - aKey).
export function diffDays(aKey: string, bKey: string): number {
  return Math.round((new Date(bKey + 'T00:00').getTime() - new Date(aKey + 'T00:00').getTime()) / 86_400_000);
}

// Given a drag gesture on a dated entry, compute its new inclusive range.
// String comparison of YYYY-MM-DD keys is chronological, so min/max are plain
// comparisons. resize-* clamps so end never precedes start; move shifts both
// ends by the days between where the drag was grabbed and the hovered day.
export type DragMode = 'resize-start' | 'resize-end' | 'move';
export function resolveDrag(
  mode: DragMode,
  orig: { startKey: string; endKey: string },
  hoverKey: string,
  grabKey: string,
): { startKey: string; endKey: string } {
  if (mode === 'resize-end') {
    return { startKey: orig.startKey, endKey: hoverKey < orig.startKey ? orig.startKey : hoverKey };
  }
  if (mode === 'resize-start') {
    return { startKey: hoverKey > orig.endKey ? orig.endKey : hoverKey, endKey: orig.endKey };
  }
  const delta = diffDays(grabKey, hoverKey);
  const shift = (k: string) => ymd(addDays(new Date(k + 'T00:00'), delta));
  return { startKey: shift(orig.startKey), endKey: shift(orig.endKey) };
}

// A single chip rendered inside a calendar cell. `payload` carries the caller's
// original entry so the click handler can map back to a domain object.
export interface CalChip {
  key: string;
  title: string;
  time?: string;
  prefix?: string;
  bg: string;
  fg: string;
  done?: boolean;
  payload?: unknown;
  // When true, the grid renders drag handles so this single-day chip can be
  // resized into a range or moved to another day (see onChipDrag).
  draggable?: boolean;
}

// A bar spanning a date range, drawn across cells in month view. The grid
// splits it into per-week segments and stacks overlapping bars into lanes.
export interface CalBar {
  key: string;
  title: string;
  startKey: string; // YYYY-MM-DD, inclusive
  endKey: string;   // YYYY-MM-DD, inclusive
  bg: string;
  fg: string;
  done?: boolean;
  payload?: unknown;
}

export interface CalendarRange {
  rangeStart: string;
  rangeEnd: string;
  gridDays: Date[];
  cols: number;
  dimOutOfMonth: boolean;
}

// Visible days + fetch range, driven by the active view. Month shows a 6-week
// grid (incl. adjacent-month days); week shows 7 days; day shows 1; table uses
// the cursor's month range and renders no grid.
export function computeCalendarRange(view: CalView, cursor: Date): CalendarRange {
  if (view === 'day') {
    const s = dayOnly(cursor);
    return { rangeStart: ymd(s), rangeEnd: ymd(addDays(s, 1)), gridDays: [s], cols: 1, dimOutOfMonth: false };
  }
  if (view === 'week') {
    const s = startOfWeek(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    return { rangeStart: ymd(s), rangeEnd: ymd(addDays(s, 7)), gridDays: days, cols: 7, dimOutOfMonth: false };
  }
  if (view === 'table') {
    const first = startOfMonth(cursor);
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    return { rangeStart: ymd(first), rangeEnd: ymd(nextMonth), gridDays: [], cols: 7, dimOutOfMonth: false };
  }
  const first = startOfMonth(cursor);
  const gridStart = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return { rangeStart: ymd(gridStart), rangeEnd: ymd(addDays(gridStart, 42)), gridDays: days, cols: 7, dimOutOfMonth: true };
}

export function useCalendarRange(view: CalView, cursor: Date): CalendarRange {
  return useMemo(() => computeCalendarRange(view, cursor), [view, cursor]);
}

// Prev/next steps by the active view's unit.
export function stepCursor(cursor: Date, view: CalView, dir: number): Date {
  const d = new Date(cursor);
  if (view === 'month' || view === 'table') d.setMonth(d.getMonth() + dir);
  else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
  else d.setDate(d.getDate() + dir);
  return d;
}

// Date labels follow the app language, not the OS locale — pass the i18n lang
// ('en' | 'ko', valid BCP47 tags) as the locale.
export function formatRangeTitle(cursor: Date, view: CalView, locale: string): string {
  if (view === 'month' || view === 'table') {
    return cursor.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
  }
  if (view === 'week') {
    const s = startOfWeek(cursor);
    return `${s.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${addDays(s, 6).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`;
  }
  return cursor.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

export function useWeekdayLabels(): string[] {
  const { lang } = useI18n();
  return useMemo(() => {
    const base = new Date(2024, 5, 2); // a Sunday
    return Array.from({ length: 7 }, (_, i) => addDays(base, i).toLocaleDateString(lang, { weekday: 'short' }));
  }, [lang]);
}
