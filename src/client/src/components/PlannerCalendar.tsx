import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Plus, MoreVertical, ArrowRight, Clock, Terminal, Trash2 } from 'lucide-react';
import type { PlannerItem as PlannerItemType } from '../types';
import { useI18n } from '../i18n';
import { getTagStyle } from './plannerTagColors';
import CalendarGrid from './calendar/CalendarGrid';
import CursorContextMenu, { ctxMenuItemClass } from './CursorContextMenu';
import {
  ymd, useCalendarRange, useWeekdayLabels, stepCursor, formatRangeTitle,
  type CalView, type CalChip,
} from './calendar/calendarShared';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-500',
  in_progress: 'bg-blue-500/10 text-blue-600',
  done: 'bg-emerald-500/10 text-emerald-600',
  moved: 'bg-purple-500/10 text-purple-600',
};

function parseTags(json: string | null): string[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; }
  catch { return []; }
}

interface PlannerCalendarProps {
  view: Exclude<CalView, 'table'>;
  items: PlannerItemType[];
  tagColors: Map<string, string>;
  onQuickAdd: (dateKey: string) => void;
  onEditItem: (item: PlannerItemType) => void;
  onConvert: (item: PlannerItemType, mode: 'todo' | 'schedule' | 'session') => void;
  onDeleteItem: (id: string) => void;
}

// A project's planner rendered as a My-Schedule-style calendar. The actual
// item interactions (edit / convert / delete) are delegated back to PlannerList
// so its existing form + convert dialog are reused.
export default function PlannerCalendar({
  view, items, tagColors, onQuickAdd, onEditItem, onConvert, onDeleteItem,
}: PlannerCalendarProps) {
  const { t } = useI18n();
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => ymd(new Date()));
  // Right-click on a day cell → "new item" pre-filled with that date.
  const [cellMenu, setCellMenu] = useState<{ x: number; y: number; dateKey: string } | null>(null);
  const weekdayLabels = useWeekdayLabels();
  const { gridDays, cols, dimOutOfMonth } = useCalendarRange(view, cursor);

  const todayKey = ymd(new Date());
  const monthIdx = cursor.getMonth();
  const maxChips = view === 'month' ? 3 : 99;

  const step = (dir: number) => setCursor((c) => stepCursor(c, view, dir));
  const goToday = () => { setCursor(new Date()); setSelectedDate(ymd(new Date())); };
  const rangeTitle = formatRangeTitle(cursor, view);

  // In day view the side panel mirrors the cursor day.
  useEffect(() => { if (view === 'day') setSelectedDate(ymd(cursor)); }, [view, cursor]);

  // Resizable side panel (drag the divider). Persisted in localStorage.
  const PANEL_MIN = 260, PANEL_MAX = 760;
  const layoutRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = parseInt(localStorage.getItem('plannerCalendarPanelWidth') || '', 10);
    return Number.isFinite(v) && v >= PANEL_MIN && v <= PANEL_MAX ? v : 320;
  });
  useEffect(() => { try { localStorage.setItem('plannerCalendarPanelWidth', String(panelWidth)); } catch { /* ignore */ } }, [panelWidth]);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = layoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, rect.right - ev.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const chipsByDay = useMemo(() => {
    const m = new Map<string, CalChip[]>();
    for (const it of items) {
      if (!it.due_date) continue;
      const key = it.due_date.slice(0, 10);
      const done = it.status === 'done';
      const arr = m.get(key) ?? [];
      arr.push({
        key: it.id,
        title: it.title,
        bg: 'var(--color-bg-secondary)',
        fg: done ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
        done,
        payload: it,
      });
      m.set(key, arr);
    }
    return m;
  }, [items]);

  const selectedItems = useMemo(
    () => items.filter((it) => it.due_date && it.due_date.slice(0, 10) === selectedDate),
    [items, selectedDate],
  );
  const backlog = useMemo(() => items.filter((it) => !it.due_date), [items]);

  return (
    <div ref={layoutRef} className="card flex overflow-hidden" style={{ minHeight: 520 }}>
      {/* Calendar column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <button onClick={() => step(-1)} className="btn-ghost p-1.5" aria-label="prev"><ChevronLeft size={16} /></button>
          <div className="text-sm font-semibold min-w-[8rem] text-center" style={{ color: 'var(--color-text-primary)' }}>{rangeTitle}</div>
          <button onClick={() => step(1)} className="btn-ghost p-1.5" aria-label="next"><ChevronRight size={16} /></button>
          <button onClick={goToday} className="btn-ghost text-xs px-2.5 py-1.5">{t('agenda.today')}</button>
        </div>
        <div className="flex-1 overflow-auto px-4 pb-4">
          <CalendarGrid
            view={view}
            gridDays={gridDays}
            cols={cols}
            dimOutOfMonth={dimOutOfMonth}
            monthIdx={monthIdx}
            todayKey={todayKey}
            selectedDate={selectedDate}
            chipsByDay={chipsByDay}
            maxChips={maxChips}
            weekdayLabels={weekdayLabels}
            addItemLabel={t('agenda.addItem')}
            onSelectDate={setSelectedDate}
            onQuickAdd={onQuickAdd}
            onChipClick={(chip) => onEditItem(chip.payload as PlannerItemType)}
            onCellContextMenu={(key, e) => { e.preventDefault(); setCellMenu({ x: e.clientX, y: e.clientY, dateKey: key }); }}
          />
        </div>
      </div>

      {/* Drag handle */}
      <div
        onPointerDown={startResize}
        className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-accent/40 transition-colors"
        style={{ backgroundColor: 'var(--color-border)' }}
        title={t('agenda.resizePanel')}
      />

      {/* Side panel: selected day + backlog */}
      <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: panelWidth }}>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {new Date(selectedDate + 'T00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' })}
          </h3>
          <button onClick={() => onQuickAdd(selectedDate)} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
            <Plus size={13} />{t('agenda.add')}
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            {selectedItems.length === 0 && (
              <p className="text-xs py-2" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.dayEmpty')}</p>
            )}
            {selectedItems.map((it) => (
              <PlannerCalendarCard key={it.id} item={it} tagColors={tagColors} onEdit={onEditItem} onConvert={onConvert} onDelete={onDeleteItem} />
            ))}
          </div>

          {/* Backlog (no due date) */}
          <div>
            <h4 className="text-2xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.backlog')}</h4>
            <div className="flex flex-col gap-1.5">
              {backlog.length === 0 && (
                <p className="text-xs py-1" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.backlogEmpty')}</p>
              )}
              {backlog.map((it) => (
                <PlannerCalendarCard key={it.id} item={it} tagColors={tagColors} onEdit={onEditItem} onConvert={onConvert} onDelete={onDeleteItem} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {cellMenu && (
        <CursorContextMenu x={cellMenu.x} y={cellMenu.y} onClose={() => setCellMenu(null)}>
          <button type="button" className={ctxMenuItemClass} onClick={() => onQuickAdd(cellMenu.dateKey)}>
            <Plus size={14} />
            {t('planner.add')}
          </button>
        </CursorContextMenu>
      )}
    </div>
  );
}

// Compact planner card for the calendar side panel, with a portal "⋮" menu that
// reuses the planner's convert/delete actions.
function PlannerCalendarCard({ item, tagColors, onEdit, onConvert, onDelete }: {
  item: PlannerItemType;
  tagColors: Map<string, string>;
  onEdit: (item: PlannerItemType) => void;
  onConvert: (item: PlannerItemType, mode: 'todo' | 'schedule' | 'session') => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const tags = parseTags(item.tags);
  const isMoved = item.status === 'moved';

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = r.bottom + 4;
    const drop = dropRef.current;
    if (drop) {
      const dw = drop.offsetWidth, dh = drop.offsetHeight;
      let left = r.right - dw;
      if (left < 8) left = 8;
      if (left + dw > vw - 8) left = vw - 8 - dw;
      if (top + dh > vh - 8) top = r.top - dh - 4;
      setPos({ top, left });
      setPositioned(true);
    } else {
      setPos({ top, left: Math.max(8, r.right - 180) });
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) { setPositioned(false); return; }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    const close = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (btnRef.current?.contains(tgt) || dropRef.current?.contains(tgt)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [menuOpen, updatePos]);

  return (
    <div className={`group flex items-start gap-2 rounded-lg px-2.5 py-2 ${isMoved ? 'opacity-50' : ''}`} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <button onClick={() => onEdit(item)} className="flex-1 text-left min-w-0">
        <div className="text-sm truncate" style={{ color: 'var(--color-text-primary)', textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>
          {item.title}
        </div>
        {item.description && <div className="text-2xs truncate" style={{ color: 'var(--color-text-muted)' }}>{item.description}</div>}
        <div className="flex flex-wrap items-center gap-1 mt-1">
          <span className={`px-1.5 py-0.5 rounded-full text-2xs font-medium ${STATUS_STYLES[item.status] || STATUS_STYLES.pending}`}>
            {t(`plannerStatus.${item.status}`)}
          </span>
          {tags.map((tag) => (
            <span key={tag} className={`px-1.5 py-0.5 rounded text-2xs font-medium ${getTagStyle(tagColors.get(tag) || 'default')}`}>{tag}</span>
          ))}
        </div>
      </button>
      <div className="flex-shrink-0">
        <button ref={btnRef} onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} className="p-1 text-warm-400 hover:text-warm-600 hover:bg-warm-100/50 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
          <MoreVertical size={14} />
        </button>
        {menuOpen && createPortal(
          <div ref={dropRef} className={`fixed z-tooltip min-w-[160px] rounded-xl py-1 shadow-elevated${positioned ? ' animate-scale-in' : ''}`}
            style={{ top: pos.top, left: pos.left, opacity: positioned ? 1 : 0, backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
            onClick={() => setMenuOpen(false)}
          >
            {!isMoved && (
              <>
                <button onClick={() => onConvert(item, 'todo')} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                  <ArrowRight size={12} /> {t('planner.convertToTask')}
                </button>
                <button onClick={() => onConvert(item, 'schedule')} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                  <Clock size={12} /> {t('planner.convertToSchedule')}
                </button>
                <button onClick={() => onConvert(item, 'session')} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                  <Terminal size={12} /> {t('planner.convertToTerminal')}
                </button>
              </>
            )}
            <button onClick={() => { if (confirm(t('planner.deleteConfirm'))) onDelete(item.id); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-md transition-colors text-left">
              <Trash2 size={12} /> {t('planner.delete')}
            </button>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
