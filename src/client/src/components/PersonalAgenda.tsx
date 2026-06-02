import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Check, RotateCcw, FolderGit2, Clock, Maximize2, Minimize2 } from 'lucide-react';
import type { PersonalItem, Agenda } from '../types';
import * as personalApi from '../api/personal';
import { useI18n } from '../i18n';

// ── date helpers ───────────────────────────────────────────────────────────
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// personal due_at + planner due_date are local/date strings → slice; schedule
// .at is a full UTC ISO → convert through Date to the local day.
function dayKeyLocalIso(iso: string): string {
  return ymd(new Date(iso));
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function dayOnly(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number): Date { const x = dayOnly(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { return addDays(d, -d.getDay()); }

type CalView = 'month' | 'week' | 'day' | 'table';

function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}

// Deterministic chip color from the tag name (no separate tags table needed).
const TAG_HUES = [210, 145, 35, 320, 265, 0, 175, 95];
function tagColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = TAG_HUES[h % TAG_HUES.length];
  return { bg: `hsla(${hue}, 60%, 50%, 0.18)`, fg: `hsl(${hue}, 65%, 70%)` };
}

interface DayEntry {
  kind: 'personal' | 'schedule' | 'planner';
  id: string;
  title: string;
  time?: string;           // HH:mm for timed personal/schedule
  done?: boolean;          // personal/planner status
  projectId?: string;      // schedule/planner deep-link
  deepLinkTab?: string;    // schedules | planner
}

export default function PersonalAgenda() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [view, setView] = useState<CalView>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [items, setItems] = useState<PersonalItem[]>([]);
  const [agenda, setAgenda] = useState<Agenda>({ personal: [], schedules: [], planner: [] });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => ymd(new Date()));

  // form state (add / edit personal item)
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<PersonalItem | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fDate, setFDate] = useState('');     // YYYY-MM-DD ('' = backlog memo)
  const [fTime, setFTime] = useState('');     // HH:mm ('' = all-day)
  const [fDone, setFDone] = useState(false);
  const [fTags, setFTags] = useState<string[]>([]);
  const [fTagInput, setFTagInput] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Visible days + fetch range, driven by the active view. Month shows a
  // 6-week grid (incl. adjacent-month days); week shows 7 days; day shows 1.
  const { rangeStart, rangeEnd, gridDays, cols, dimOutOfMonth } = useMemo(() => {
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
      // Table lists project entries for the cursor's month (personal items are
      // shown in full regardless of range).
      const first = startOfMonth(cursor);
      const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      return { rangeStart: ymd(first), rangeEnd: ymd(nextMonth), gridDays: [], cols: 7, dimOutOfMonth: false };
    }
    const first = startOfMonth(cursor);
    const gridStart = addDays(first, -first.getDay());
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    return { rangeStart: ymd(gridStart), rangeEnd: ymd(addDays(gridStart, 42)), gridDays: days, cols: 7, dimOutOfMonth: true };
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, ag] = await Promise.all([
        personalApi.getPersonalItems(),
        personalApi.getAgenda(rangeStart, rangeEnd),
      ]);
      setItems(all);
      setAgenda(ag);
    } catch {
      // ignore — empty state
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  // In day view the side panel mirrors the cursor day.
  useEffect(() => { if (view === 'day') setSelectedDate(ymd(cursor)); }, [view, cursor]);

  const matchesTag = useCallback((p: PersonalItem) => !activeTag || parseTags(p.tags).includes(activeTag), [activeTag]);

  // Bucket all entries by local day key.
  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const push = (key: string, e: DayEntry) => {
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    };
    for (const p of items) {
      if (!p.due_at || !matchesTag(p)) continue;
      const key = p.due_at.slice(0, 10);
      const time = p.all_day ? undefined : p.due_at.slice(11, 16) || undefined;
      push(key, { kind: 'personal', id: p.id, title: p.title, time, done: p.status === 'done' });
    }
    // A tag filter is about personal items — hide project roll-ups while active.
    for (const s of activeTag ? [] : agenda.schedules) {
      if (!s.at) continue;
      const key = dayKeyLocalIso(s.at);
      const time = new Date(s.at).toTimeString().slice(0, 5);
      push(key, { kind: 'schedule', id: s.id, title: `${s.project_name} · ${s.title}`, time, projectId: s.project_id, deepLinkTab: 'schedules' });
    }
    for (const pl of activeTag ? [] : agenda.planner) {
      const key = pl.due_date.slice(0, 10);
      push(key, { kind: 'planner', id: pl.id, title: `${pl.project_name} · ${pl.title}`, done: pl.status === 'done', projectId: pl.project_id, deepLinkTab: 'planner' });
    }
    return map;
  }, [items, agenda, activeTag, matchesTag]);

  const backlog = useMemo(() => items.filter((i) => !i.due_at && matchesTag(i)), [items, matchesTag]);

  // All distinct tags across personal items, for the filter row.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of items) for (const tg of parseTags(p.tags)) set.add(tg);
    return Array.from(set).sort();
  }, [items]);

  // Flat list for the table view: all personal items + project entries in
  // range, sorted by date (undated personal items sink to the bottom).
  interface TableRow {
    kind: 'personal' | 'schedule' | 'planner';
    id: string;
    title: string;
    dateKey: string | null;
    time: string | null;
    status?: string;
    item?: PersonalItem;
    projectId?: string;
    deepLinkTab?: string;
  }
  const tableRows = useMemo<TableRow[]>(() => {
    const rows: TableRow[] = [];
    for (const p of items) {
      if (!matchesTag(p)) continue;
      rows.push({
        kind: 'personal', id: p.id, title: p.title,
        dateKey: p.due_at ? p.due_at.slice(0, 10) : null,
        time: p.due_at && !p.all_day ? p.due_at.slice(11, 16) : null,
        status: p.status, item: p,
      });
    }
    for (const s of activeTag ? [] : agenda.schedules) {
      rows.push({
        kind: 'schedule', id: s.id, title: `${s.project_name} · ${s.title}`,
        dateKey: s.at ? dayKeyLocalIso(s.at) : null,
        time: s.at ? new Date(s.at).toTimeString().slice(0, 5) : null,
        projectId: s.project_id, deepLinkTab: 'schedules',
      });
    }
    for (const pl of activeTag ? [] : agenda.planner) {
      rows.push({
        kind: 'planner', id: pl.id, title: `${pl.project_name} · ${pl.title}`,
        dateKey: pl.due_date.slice(0, 10), time: null,
        status: pl.status, projectId: pl.project_id, deepLinkTab: 'planner',
      });
    }
    rows.sort((a, b) => {
      if (!a.dateKey && !b.dateKey) return 0;
      if (!a.dateKey) return 1;
      if (!b.dateKey) return -1;
      const d = a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0;
      if (d !== 0) return d;
      return (a.time || '').localeCompare(b.time || '');
    });
    return rows;
  }, [items, agenda, activeTag, matchesTag]);

  const weekdayLabels = useMemo(() => {
    const base = new Date(2024, 5, 2); // a Sunday
    return Array.from({ length: 7 }, (_, i) => addDays(base, i).toLocaleDateString(undefined, { weekday: 'short' }));
  }, []);

  const todayKey = ymd(new Date());
  const monthIdx = cursor.getMonth();
  const maxChips = view === 'month' ? 3 : 99;

  // Prev/next steps by the active view's unit.
  const step = (dir: number) => setCursor((c) => {
    const d = new Date(c);
    if (view === 'month' || view === 'table') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    return d;
  });
  const goToday = () => { setCursor(new Date()); setSelectedDate(ymd(new Date())); };

  const rangeTitle = (view === 'month' || view === 'table')
    ? cursor.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : view === 'week'
      ? `${startOfWeek(cursor).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(startOfWeek(cursor), 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : cursor.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

  // ── form ───────────────────────────────────────────────────────────────
  const openAdd = (dateKey?: string) => {
    setEditing(null);
    setFTitle('');
    setFDesc('');
    setFDate(dateKey ?? selectedDate);
    setFTime('');
    setFDone(false);
    setFTags(activeTag ? [activeTag] : []);
    setFTagInput('');
    setShowForm(true);
  };
  const openEdit = (p: PersonalItem) => {
    setEditing(p);
    setFTitle(p.title);
    setFDesc(p.description ?? '');
    setFDate(p.due_at ? p.due_at.slice(0, 10) : '');
    setFTime(p.due_at && !p.all_day ? p.due_at.slice(11, 16) : '');
    setFDone(p.status === 'done');
    setFTags(parseTags(p.tags));
    setFTagInput('');
    setShowForm(true);
  };
  const addTag = (raw: string) => {
    const tg = raw.trim();
    if (!tg) return;
    setFTags((prev) => (prev.includes(tg) ? prev : [...prev, tg]));
    setFTagInput('');
  };
  const removeTag = (tg: string) => setFTags((prev) => prev.filter((x) => x !== tg));
  const closeForm = () => { setShowForm(false); setEditing(null); setExpanded(false); };

  const submitForm = async () => {
    const title = fTitle.trim();
    if (!title) return;
    const allDay = fDate ? (fTime ? 0 : 1) : 1;
    const dueAt = fDate ? (fTime ? `${fDate}T${fTime}` : fDate) : null;
    const tags = fTags.length ? fTags : null;
    const payload = { title, description: fDesc.trim() || undefined, due_at: dueAt, all_day: allDay, tags };
    if (editing) {
      await personalApi.updatePersonalItem(editing.id, { ...payload, status: fDone ? 'done' : 'pending' });
    } else {
      await personalApi.createPersonalItem(payload);
    }
    closeForm();
    load();
  };

  const toggleDone = async (p: PersonalItem) => {
    await personalApi.updatePersonalItem(p.id, { status: p.status === 'done' ? 'pending' : 'done' });
    load();
  };
  const remove = async (p: PersonalItem) => {
    if (!window.confirm(t('agenda.confirmDelete') || 'Delete this item?')) return;
    await personalApi.deletePersonalItem(p.id);
    load();
  };

  const selectedEntries = byDay.get(selectedDate) ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Calendar column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
              <CalendarDays size={20} />
              {t('agenda.title')}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('agenda.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* View toggle: month / week / day */}
            <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
              {(['month', 'week', 'day', 'table'] as CalView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="px-2.5 py-1 text-xs rounded-md transition-all"
                  style={view === v
                    ? { backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)', fontWeight: 600 }
                    : { color: 'var(--color-text-tertiary)' }}
                >
                  {t(`agenda.view.${v}`)}
                </button>
              ))}
            </div>
            <button onClick={() => step(-1)} className="btn-ghost p-1.5" aria-label="prev">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium min-w-[140px] text-center" style={{ color: 'var(--color-text-primary)' }}>
              {rangeTitle}
            </span>
            <button onClick={() => step(1)} className="btn-ghost p-1.5" aria-label="next">
              <ChevronRight size={16} />
            </button>
            <button onClick={goToday} className="btn-ghost text-xs px-2.5 py-1.5">
              {t('agenda.today')}
            </button>
            <button onClick={load} className="btn-ghost p-1.5" aria-label="refresh">
              <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Tag filter row */}
        {allTags.length > 0 && (
          <div className="px-6 pb-3 flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveTag(null)}
              className="text-2xs px-2 py-0.5 rounded-full transition-colors"
              style={!activeTag
                ? { backgroundColor: 'var(--color-accent)', color: '#fff' }
                : { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
            >
              {t('agenda.tags.all')}
            </button>
            {allTags.map((tg) => {
              const c = tagColor(tg);
              const on = activeTag === tg;
              return (
                <button
                  key={tg}
                  onClick={() => setActiveTag(on ? null : tg)}
                  className="text-2xs px-2 py-0.5 rounded-full transition-colors"
                  style={{ backgroundColor: c.bg, color: c.fg, outline: on ? `1px solid ${c.fg}` : 'none' }}
                >
                  #{tg}
                </button>
              );
            })}
          </div>
        )}

        {/* Calendar grid (month: 6×7, week: 1×7, day: 1×1) */}
        <div className="flex-1 overflow-auto px-6 pb-6">
          {(view === 'month' || view === 'week') && (
            <div className="grid gap-px text-2xs uppercase tracking-wider mb-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, color: 'var(--color-text-muted)' }}>
              {weekdayLabels.map((w) => (<div key={w} className="px-2 py-1">{w}</div>))}
            </div>
          )}
          {view !== 'table' && (
          <div
            className="grid gap-px rounded-xl overflow-hidden"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, backgroundColor: 'var(--color-border)' }}
          >
            {gridDays.map((d) => {
              const key = ymd(d);
              const entries = byDay.get(key) ?? [];
              const inMonth = !dimOutOfMonth || d.getMonth() === monthIdx;
              const isToday = key === todayKey;
              const isSelected = key === selectedDate;
              const cellMin = view === 'month' ? 'min-h-[92px]' : view === 'week' ? 'min-h-[360px]' : 'min-h-[480px]';
              return (
                <div
                  key={key}
                  onClick={() => setSelectedDate(key)}
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
                  {/* Quick-add on this day (Notion-style): hover the cell to
                      reveal a "+" that opens the form with this date pre-filled. */}
                  <button
                    onClick={(ev) => { ev.stopPropagation(); openAdd(key); }}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-md w-5 h-5 flex items-center justify-center hover:bg-theme-hover"
                    title={t('agenda.addItem')}
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    <Plus size={13} />
                  </button>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {entries.slice(0, maxChips).map((e) => (
                      <span
                        key={`${e.kind}-${e.id}`}
                        className="text-2xs truncate px-1 py-0.5 rounded"
                        style={{
                          backgroundColor: e.kind === 'personal' ? 'var(--color-accent-soft, rgba(99,102,241,0.15))' : 'var(--color-bg-secondary)',
                          color: e.done ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                          textDecoration: e.done ? 'line-through' : 'none',
                        }}
                        title={e.title}
                      >
                        {e.kind !== 'personal' && '· '}{e.time ? `${e.time} ` : ''}{e.title}
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
          )}

          {/* Table view */}
          {view === 'table' && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div
                className="grid items-center px-3 py-2 text-2xs uppercase tracking-wider"
                style={{ gridTemplateColumns: '1fr 150px 96px 72px', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
              >
                <span>{t('agenda.table.name')}</span>
                <span>{t('agenda.table.date')}</span>
                <span>{t('agenda.table.kind')}</span>
                <span>{t('agenda.table.status')}</span>
              </div>
              {tableRows.length === 0 && (
                <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.dayEmpty')}</div>
              )}
              {tableRows.map((r) => {
                const dateLabel = r.dateKey
                  ? new Date(r.dateKey + 'T00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + (r.time ? ` ${r.time}` : '')
                  : '—';
                const onRowClick = () => {
                  if (r.kind === 'personal' && r.item) openEdit(r.item);
                  else if (r.projectId) navigate(`/projects/${r.projectId}?tab=${r.deepLinkTab}`);
                };
                return (
                  <div
                    key={`${r.kind}-${r.id}`}
                    onClick={onRowClick}
                    className="grid items-center px-3 py-2.5 text-sm cursor-pointer transition-colors hover:bg-theme-hover"
                    style={{ gridTemplateColumns: '1fr 150px 96px 72px', borderTop: '1px solid var(--color-border)' }}
                  >
                    <span className="flex items-center gap-1.5 min-w-0 pr-2">
                      <span className="truncate" style={{ color: 'var(--color-text-primary)', textDecoration: r.status === 'done' ? 'line-through' : 'none' }} title={r.title}>
                        {r.title}
                      </span>
                      {r.item && parseTags(r.item.tags).slice(0, 3).map((tg) => {
                        const c = tagColor(tg);
                        return <span key={tg} className="text-2xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.bg, color: c.fg }}>#{tg}</span>;
                      })}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{dateLabel}</span>
                    <span className="text-2xs">
                      <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
                        {t(`agenda.kind.${r.kind}`)}
                      </span>
                    </span>
                    <span className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
                      {r.status ? t(r.status === 'done' ? 'agenda.status.done' : 'agenda.status.pending') : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Side panel: selected day + backlog */}
      <div className="w-[320px] flex-shrink-0 border-l flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-4 pt-5 pb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {new Date(selectedDate + 'T00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' })}
          </h2>
          <button onClick={() => openAdd(selectedDate)} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
            <Plus size={13} />{t('agenda.add')}
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 pb-6 flex flex-col gap-4">
          {/* Selected day entries */}
          <div className="flex flex-col gap-1.5">
            {selectedEntries.length === 0 && (
              <p className="text-xs py-2" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.dayEmpty')}</p>
            )}
            {selectedEntries.map((e) => {
              if (e.kind === 'personal') {
                const item = items.find((i) => i.id === e.id)!;
                return (
                  <div key={e.id} className="group flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    <button onClick={() => toggleDone(item)} className="mt-0.5 flex-shrink-0" title={t('agenda.toggleDone')}>
                      <span className="w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-accent)' }}>
                        {item.status === 'done' && <Check size={11} />}
                      </span>
                    </button>
                    <button onClick={() => openEdit(item)} className="flex-1 text-left min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--color-text-primary)', textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>
                        {e.time && <span className="text-2xs mr-1" style={{ color: 'var(--color-text-muted)' }}>{e.time}</span>}
                        {item.title}
                      </div>
                      {item.description && <div className="text-2xs truncate" style={{ color: 'var(--color-text-muted)' }}>{item.description}</div>}
                      {parseTags(item.tags).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {parseTags(item.tags).map((tg) => {
                            const c = tagColor(tg);
                            return <span key={tg} className="text-2xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: c.bg, color: c.fg }}>#{tg}</span>;
                          })}
                        </div>
                      )}
                    </button>
                    <button onClick={() => remove(item)} className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" title={t('agenda.delete')}>
                      <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                    </button>
                  </div>
                );
              }
              // read-only project entry (schedule / planner)
              return (
                <Link
                  key={`${e.kind}-${e.id}`}
                  to={`/projects/${e.projectId}?tab=${e.deepLinkTab}`}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-2 hover:opacity-80 transition-opacity"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px dashed var(--color-border)' }}
                >
                  {e.kind === 'schedule' ? <Clock size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} /> : <FolderGit2 size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>
                      {e.time && <span className="text-2xs mr-1" style={{ color: 'var(--color-text-muted)' }}>{e.time}</span>}
                      {e.title}
                    </div>
                    <div className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
                      {e.kind === 'schedule' ? t('agenda.fromSchedule') : t('agenda.fromPlanner')}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Backlog (undated memos) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-2xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.backlog')}</h3>
              <button onClick={() => openAdd('')} className="btn-ghost text-2xs px-1.5 py-0.5 flex items-center gap-1">
                <Plus size={11} />{t('agenda.memo')}
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {backlog.length === 0 && (
                <p className="text-xs py-1" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.backlogEmpty')}</p>
              )}
              {backlog.map((item) => (
                <div key={item.id} className="group flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                  <button onClick={() => toggleDone(item)} className="mt-0.5 flex-shrink-0">
                    <span className="w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-accent)' }}>
                      {item.status === 'done' && <Check size={11} />}
                    </span>
                  </button>
                  <button onClick={() => openEdit(item)} className="flex-1 text-left min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--color-text-primary)', textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>{item.title}</div>
                    {item.description && <div className="text-2xs truncate" style={{ color: 'var(--color-text-muted)' }}>{item.description}</div>}
                    {parseTags(item.tags).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {parseTags(item.tags).map((tg) => {
                          const c = tagColor(tg);
                          return <span key={tg} className="text-2xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: c.bg, color: c.fg }}>#{tg}</span>;
                        })}
                      </div>
                    )}
                  </button>
                  <button onClick={() => remove(item)} className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                    <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add / edit form modal — expandable to a full-page view */}
      {showForm && (
        <div className="fixed inset-0 z-tooltip flex items-center justify-center p-6" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={closeForm}>
          <div
            className={`rounded-2xl shadow-xl flex flex-col ${expanded ? 'w-[94vw] h-[92vh] max-w-[1200px]' : 'w-full max-w-3xl'}`}
            style={{ backgroundColor: 'var(--color-bg-card)', maxHeight: expanded ? '92vh' : '88vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top bar: expand/collapse (top-left, Notion-style) */}
            <div className="flex items-center justify-between px-5 pt-4">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="btn-ghost p-1.5"
                title={expanded ? t('agenda.collapse') : t('agenda.expand')}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <span className="text-2xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {editing ? t('agenda.editTitle') : t('agenda.addTitle')}
              </span>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-auto px-5 pb-3">
              <div className={`flex flex-col gap-3 h-full ${expanded ? 'max-w-[820px] mx-auto w-full pt-2' : ''}`}>
                <input
                  autoFocus
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitForm(); } }}
                  placeholder={t('agenda.titlePlaceholder')}
                  className={`bg-transparent border-none outline-none font-semibold ${expanded ? 'text-3xl' : 'text-xl'}`}
                  style={{ color: 'var(--color-text-primary)' }}
                />
                {/* Properties: date/time + status */}
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className="input-field w-auto" />
                  <input type="time" value={fTime} onChange={(e) => setFTime(e.target.value)} disabled={!fDate} className="input-field w-auto disabled:opacity-40" />
                  {editing && (
                    <button
                      onClick={() => setFDone((v) => !v)}
                      className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                      style={fDone ? { color: 'var(--color-accent)' } : undefined}
                    >
                      <span className="w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: 'var(--color-border)' }}>
                        {fDone && <Check size={11} />}
                      </span>
                      {t(fDone ? 'agenda.status.done' : 'agenda.status.pending')}
                    </button>
                  )}
                </div>
                <p className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.dateHint')}</p>
                {/* Tags */}
                <div className="flex items-center gap-1.5 flex-wrap rounded-lg px-2 py-1.5" style={{ border: '1px solid var(--color-border)' }}>
                  {fTags.map((tg) => {
                    const c = tagColor(tg);
                    return (
                      <span key={tg} className="text-2xs px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: c.bg, color: c.fg }}>
                        #{tg}
                        <button onClick={() => removeTag(tg)} className="hover:opacity-70" title={t('agenda.delete')}>×</button>
                      </span>
                    );
                  })}
                  <input
                    value={fTagInput}
                    onChange={(e) => setFTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(fTagInput); }
                      else if (e.key === 'Backspace' && !fTagInput && fTags.length) { removeTag(fTags[fTags.length - 1]); }
                    }}
                    onBlur={() => addTag(fTagInput)}
                    placeholder={fTags.length ? '' : t('agenda.tags.placeholder')}
                    className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-sm"
                    style={{ color: 'var(--color-text-primary)' }}
                  />
                </div>
                <textarea
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  placeholder={t('agenda.descPlaceholder')}
                  className="input-field flex-1 min-h-[280px] resize-y leading-relaxed"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={closeForm} className="btn-ghost text-sm">{t('agenda.cancel')}</button>
              <button onClick={submitForm} disabled={!fTitle.trim()} className="btn-primary text-sm disabled:opacity-40">{t('agenda.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
