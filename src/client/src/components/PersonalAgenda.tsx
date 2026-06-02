import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Check, RotateCcw, FolderGit2, Clock } from 'lucide-react';
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

type CalView = 'month' | 'week' | 'day';

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
  const [view, setView] = useState<CalView>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [items, setItems] = useState<PersonalItem[]>([]);
  const [agenda, setAgenda] = useState<Agenda>({ personal: [], schedules: [], planner: [] });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => ymd(new Date()));

  // form state (add / edit personal item)
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PersonalItem | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fDate, setFDate] = useState('');     // YYYY-MM-DD ('' = backlog memo)
  const [fTime, setFTime] = useState('');     // HH:mm ('' = all-day)

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

  // Bucket all entries by local day key.
  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const push = (key: string, e: DayEntry) => {
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    };
    for (const p of items) {
      if (!p.due_at) continue;
      const key = p.due_at.slice(0, 10);
      const time = p.all_day ? undefined : p.due_at.slice(11, 16) || undefined;
      push(key, { kind: 'personal', id: p.id, title: p.title, time, done: p.status === 'done' });
    }
    for (const s of agenda.schedules) {
      if (!s.at) continue;
      const key = dayKeyLocalIso(s.at);
      const time = new Date(s.at).toTimeString().slice(0, 5);
      push(key, { kind: 'schedule', id: s.id, title: `${s.project_name} · ${s.title}`, time, projectId: s.project_id, deepLinkTab: 'schedules' });
    }
    for (const pl of agenda.planner) {
      const key = pl.due_date.slice(0, 10);
      push(key, { kind: 'planner', id: pl.id, title: `${pl.project_name} · ${pl.title}`, done: pl.status === 'done', projectId: pl.project_id, deepLinkTab: 'planner' });
    }
    return map;
  }, [items, agenda]);

  const backlog = useMemo(() => items.filter((i) => !i.due_at), [items]);

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
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    return d;
  });
  const goToday = () => { setCursor(new Date()); setSelectedDate(ymd(new Date())); };

  const rangeTitle = view === 'month'
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
    setShowForm(true);
  };
  const openEdit = (p: PersonalItem) => {
    setEditing(p);
    setFTitle(p.title);
    setFDesc(p.description ?? '');
    setFDate(p.due_at ? p.due_at.slice(0, 10) : '');
    setFTime(p.due_at && !p.all_day ? p.due_at.slice(11, 16) : '');
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditing(null); };

  const submitForm = async () => {
    const title = fTitle.trim();
    if (!title) return;
    const allDay = fDate ? (fTime ? 0 : 1) : 1;
    const dueAt = fDate ? (fTime ? `${fDate}T${fTime}` : fDate) : null;
    const payload = { title, description: fDesc.trim() || undefined, due_at: dueAt, all_day: allDay };
    if (editing) {
      await personalApi.updatePersonalItem(editing.id, payload);
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
              {(['month', 'week', 'day'] as CalView[]).map((v) => (
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

        {/* Calendar grid (month: 6×7, week: 1×7, day: 1×1) */}
        <div className="flex-1 overflow-auto px-6 pb-6">
          {view !== 'day' && (
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
              const entries = byDay.get(key) ?? [];
              const inMonth = !dimOutOfMonth || d.getMonth() === monthIdx;
              const isToday = key === todayKey;
              const isSelected = key === selectedDate;
              const cellMin = view === 'month' ? 'min-h-[92px]' : view === 'week' ? 'min-h-[360px]' : 'min-h-[480px]';
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDate(key)}
                  className={`${cellMin} text-left p-1.5 flex flex-col gap-1 transition-colors`}
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
                </button>
              );
            })}
          </div>
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

      {/* Add / edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-tooltip flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={closeForm}>
          <div className="w-full max-w-md rounded-2xl p-5 shadow-xl" style={{ backgroundColor: 'var(--color-bg-card)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
              {editing ? t('agenda.editTitle') : t('agenda.addTitle')}
            </h3>
            <div className="flex flex-col gap-3">
              <input
                autoFocus
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitForm(); } }}
                placeholder={t('agenda.titlePlaceholder')}
                className="input-field"
              />
              <textarea
                value={fDesc}
                onChange={(e) => setFDesc(e.target.value)}
                placeholder={t('agenda.descPlaceholder')}
                rows={2}
                className="input-field resize-none"
              />
              <div className="flex items-center gap-2">
                <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className="input-field flex-1" />
                <input type="time" value={fTime} onChange={(e) => setFTime(e.target.value)} disabled={!fDate} className="input-field flex-1 disabled:opacity-40" />
              </div>
              <p className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.dateHint')}</p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={closeForm} className="btn-ghost text-sm">{t('agenda.cancel')}</button>
              <button onClick={submitForm} disabled={!fTitle.trim()} className="btn-primary text-sm disabled:opacity-40">{t('agenda.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
