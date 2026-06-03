import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Check, RotateCcw, FolderGit2, Clock, Maximize2, Minimize2, Settings, ExternalLink, Download, Image as ImageIcon, X } from 'lucide-react';
import type { PersonalItem, Agenda, JiraAgendaEntry, AgendaJiraConfig, ImageMeta, Project } from '../types';
import * as personalApi from '../api/personal';
import { getProjects } from '../api/projects';
import HoverHelp from './HoverHelp';
import ImageLightbox from './ImageLightbox';
import MoveToPlannerButton from './MoveToPlannerButton';
import { useI18n } from '../i18n';
import CalendarGrid from './calendar/CalendarGrid';
import {
  ymd, dayKeyLocalIso,
  useCalendarRange, useWeekdayLabels, stepCursor, formatRangeTitle,
  type CalView, type CalChip,
} from './calendar/calendarShared';

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

type EntryKind = 'personal' | 'schedule' | 'planner' | 'jira';
interface DayEntry {
  kind: EntryKind;
  id: string;
  title: string;
  time?: string;           // HH:mm for timed personal/schedule
  done?: boolean;          // personal/planner status
  projectId?: string;      // schedule/planner deep-link
  deepLinkTab?: string;    // schedules | planner
  url?: string;            // jira external link
}

const JIRA_BLUE = { bg: 'rgba(38,132,255,0.18)', fg: 'rgb(101,164,255)' };

// Soft color chip per entry kind (matches the tag-chip aesthetic).
function kindStyle(kind: EntryKind): { bg: string; fg: string } {
  switch (kind) {
    case 'jira': return JIRA_BLUE;
    case 'personal': return { bg: 'hsla(238, 70%, 60%, 0.18)', fg: 'hsl(238, 70%, 72%)' };
    case 'schedule': return { bg: 'hsla(160, 60%, 45%, 0.18)', fg: 'hsl(160, 60%, 62%)' };
    case 'planner': return { bg: 'hsla(35, 80%, 55%, 0.20)', fg: 'hsl(35, 85%, 66%)' };
  }
}

// Stable ordering for the "kind" sort in the table view.
const KIND_ORDER: Record<EntryKind, number> = { personal: 0, schedule: 1, planner: 2, jira: 3 };

// Soft color chip for the status column (same translucent tone as kind chips).
const STATUS_DONE = { bg: 'hsla(145, 60%, 48%, 0.18)', fg: 'hsl(145, 60%, 66%)' };
const STATUS_PENDING = { bg: 'hsla(218, 32%, 56%, 0.20)', fg: 'hsl(218, 36%, 78%)' };

interface PendingImage {
  id: string;
  name: string;
  data: string;
  preview: string;
}
let imageCounter = 0;

export default function PersonalAgenda() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [view, setView] = useState<CalView>('month');
  const [sort, setSort] = useState<{ key: 'date' | 'kind' | 'status'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'asc' });
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [items, setItems] = useState<PersonalItem[]>([]);
  const [agenda, setAgenda] = useState<Agenda>({ personal: [], schedules: [], planner: [] });
  const [jiraEntries, setJiraEntries] = useState<JiraAgendaEntry[]>([]);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraConfig, setJiraConfig] = useState<AgendaJiraConfig | null>(null);
  const [showJiraSettings, setShowJiraSettings] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState({ personal: true, schedule: true, planner: true, jira: true });
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
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [existingImages, setExistingImages] = useState<ImageMeta[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Resizable side panel (drag the divider). Persisted in localStorage.
  const PANEL_MIN = 260, PANEL_MAX = 760;
  const layoutRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = parseInt(localStorage.getItem('agendaPanelWidth') || '', 10);
    return Number.isFinite(v) && v >= PANEL_MIN && v <= PANEL_MAX ? v : 320;
  });
  useEffect(() => { try { localStorage.setItem('agendaPanelWidth', String(panelWidth)); } catch { /* ignore */ } }, [panelWidth]);
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

  // Visible days + fetch range, driven by the active view.
  const { rangeStart, rangeEnd, gridDays, cols, dimOutOfMonth } = useCalendarRange(view, cursor);

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
    // Jira is fetched separately so a Jira failure never blocks the calendar.
    try {
      const { issues } = await personalApi.getAgendaJira(rangeStart, rangeEnd);
      setJiraEntries(issues);
      setJiraError(null);
    } catch (e) {
      setJiraEntries([]);
      setJiraError(e instanceof Error ? e.message : 'Jira fetch failed');
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { load(); }, [load]);

  // Load the Jira connection status once.
  useEffect(() => { personalApi.getJiraConfig().then(setJiraConfig).catch(() => setJiraConfig(null)); }, []);
  const jiraOn = !!(jiraConfig?.enabled && jiraConfig.hasToken);

  // Projects for the "move to planner" picker.
  useEffect(() => { getProjects().then(setProjects).catch(() => setProjects([])); }, []);
  const moveToPlanner = (item: PersonalItem, projectId: string) => personalApi.movePersonalItemToPlanner(item.id, projectId).then(load);
  const jiraToPlanner = (entry: JiraAgendaEntry, projectId: string) => personalApi.importJiraIssueToPlanner(entry, projectId).then(load);

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
    for (const p of sources.personal ? items : []) {
      if (!p.due_at || !matchesTag(p)) continue;
      const key = p.due_at.slice(0, 10);
      const time = p.all_day ? undefined : p.due_at.slice(11, 16) || undefined;
      push(key, { kind: 'personal', id: p.id, title: p.title, time, done: p.status === 'done' });
    }
    // A tag filter is about personal items — hide project/Jira roll-ups while active.
    for (const s of (activeTag || !sources.schedule) ? [] : agenda.schedules) {
      if (!s.at) continue;
      const key = dayKeyLocalIso(s.at);
      const time = new Date(s.at).toTimeString().slice(0, 5);
      push(key, { kind: 'schedule', id: s.id, title: `${s.project_name} · ${s.title}`, time, projectId: s.project_id, deepLinkTab: 'schedules' });
    }
    for (const pl of (activeTag || !sources.planner) ? [] : agenda.planner) {
      const key = pl.due_date.slice(0, 10);
      push(key, { kind: 'planner', id: pl.id, title: `${pl.project_name} · ${pl.title}`, done: pl.status === 'done', projectId: pl.project_id, deepLinkTab: 'planner' });
    }
    for (const j of (activeTag || !sources.jira) ? [] : jiraEntries) {
      if (!j.duedate) continue;
      push(j.duedate.slice(0, 10), { kind: 'jira', id: j.key, title: `${j.key} · ${j.summary}`, url: j.url });
    }
    return map;
  }, [items, agenda, jiraEntries, activeTag, matchesTag, sources]);

  // Map the source-specific day entries to generic calendar chips, preserving
  // the per-kind chip colors.
  const chipsByDay = useMemo(() => {
    const m = new Map<string, CalChip[]>();
    for (const [key, entries] of byDay) {
      m.set(key, entries.map((e) => ({
        key: `${e.kind}-${e.id}`,
        title: e.title,
        time: e.time,
        prefix: e.kind !== 'personal' ? '· ' : undefined,
        bg: kindStyle(e.kind).bg,
        fg: e.done ? 'var(--color-text-muted)' : kindStyle(e.kind).fg,
        done: e.done,
        payload: e,
      })));
    }
    return m;
  }, [byDay]);

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
    kind: EntryKind;
    id: string;
    title: string;
    dateKey: string | null;
    time: string | null;
    status?: string;
    item?: PersonalItem;
    projectId?: string;
    deepLinkTab?: string;
    url?: string;
  }
  const tableRows = useMemo<TableRow[]>(() => {
    const rows: TableRow[] = [];
    for (const p of sources.personal ? items : []) {
      if (!matchesTag(p)) continue;
      rows.push({
        kind: 'personal', id: p.id, title: p.title,
        dateKey: p.due_at ? p.due_at.slice(0, 10) : null,
        time: p.due_at && !p.all_day ? p.due_at.slice(11, 16) : null,
        status: p.status, item: p,
      });
    }
    for (const s of (activeTag || !sources.schedule) ? [] : agenda.schedules) {
      rows.push({
        kind: 'schedule', id: s.id, title: `${s.project_name} · ${s.title}`,
        dateKey: s.at ? dayKeyLocalIso(s.at) : null,
        time: s.at ? new Date(s.at).toTimeString().slice(0, 5) : null,
        projectId: s.project_id, deepLinkTab: 'schedules',
      });
    }
    for (const pl of (activeTag || !sources.planner) ? [] : agenda.planner) {
      rows.push({
        kind: 'planner', id: pl.id, title: `${pl.project_name} · ${pl.title}`,
        dateKey: pl.due_date.slice(0, 10), time: null,
        status: pl.status, projectId: pl.project_id, deepLinkTab: 'planner',
      });
    }
    for (const j of (activeTag || !sources.jira) ? [] : jiraEntries) {
      rows.push({
        kind: 'jira', id: j.key, title: `${j.key} · ${j.summary}`,
        dateKey: j.duedate ? j.duedate.slice(0, 10) : null, time: null,
        status: j.status, url: j.url,
      });
    }
    const byDate = (a: TableRow, b: TableRow) => {
      // Undated rows always sink to the bottom, regardless of direction.
      if (!a.dateKey && !b.dateKey) return 0;
      if (!a.dateKey) return 1;
      if (!b.dateKey) return -1;
      const d = a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0;
      return d !== 0 ? d : (a.time || '').localeCompare(b.time || '');
    };
    const sign = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let c = 0;
      if (sort.key === 'kind') {
        c = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      } else if (sort.key === 'status') {
        // Empty status sinks to the bottom regardless of direction.
        const sa = a.status || '', sb = b.status || '';
        if (!sa && !sb) c = 0;
        else if (!sa) return 1;
        else if (!sb) return -1;
        else c = sa.localeCompare(sb);
      } else {
        return byDate(a, b) * sign;
      }
      // Stable tiebreak by date so equal keys stay chronologically grouped.
      return c !== 0 ? c * sign : byDate(a, b);
    });
    return rows;
  }, [items, agenda, jiraEntries, activeTag, matchesTag, sources, sort]);

  const weekdayLabels = useWeekdayLabels();

  const todayKey = ymd(new Date());
  const monthIdx = cursor.getMonth();
  const maxChips = view === 'month' ? 3 : 99;

  const step = (dir: number) => setCursor((c) => stepCursor(c, view, dir));
  const goToday = () => { setCursor(new Date()); setSelectedDate(ymd(new Date())); };

  const rangeTitle = formatRangeTitle(cursor, view);

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
    setPendingImages([]);
    setExistingImages([]);
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
    setPendingImages([]);
    try { setExistingImages(p.images ? JSON.parse(p.images) : []); } catch { setExistingImages([]); }
    setShowForm(true);
  };
  const addTag = (raw: string) => {
    const tg = raw.trim();
    if (!tg) return;
    setFTags((prev) => (prev.includes(tg) ? prev : [...prev, tg]));
    setFTagInput('');
  };
  const removeTag = (tg: string) => setFTags((prev) => prev.filter((x) => x !== tg));
  const closeForm = () => { setShowForm(false); setEditing(null); setExpanded(false); setPendingImages([]); setExistingImages([]); };

  const addImagesFromFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        const id = `pending-${++imageCounter}`;
        setPendingImages((prev) => [...prev, { id, name: file.name, data, preview: data }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clip = e.clipboardData?.items;
    if (!clip) return;
    const files: File[] = [];
    for (let i = 0; i < clip.length; i++) {
      if (clip[i].type.startsWith('image/')) {
        const file = clip[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    addImagesFromFiles(files);
  }, [addImagesFromFiles]);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files) addImagesFromFiles(e.dataTransfer.files);
  }, [addImagesFromFiles]);
  const removePendingImage = (id: string) => setPendingImages((prev) => prev.filter((img) => img.id !== id));
  const removeExistingImage = (imageId: string) => {
    if (editing) personalApi.deletePersonalImage(editing.id, imageId);
    setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
  };
  const totalImages = existingImages.length + pendingImages.length;

  // Saveable when there's a title OR a body (title is optional, like Notion).
  const canSave = !!(fTitle.trim() || fDesc.trim());
  const submitForm = async () => {
    if (!canSave) return;
    // Empty title → use the first line of the body, else "(untitled)".
    const title = fTitle.trim()
      || fDesc.trim().split('\n')[0].slice(0, 80)
      || t('agenda.untitled');
    const allDay = fDate ? (fTime ? 0 : 1) : 1;
    const dueAt = fDate ? (fTime ? `${fDate}T${fTime}` : fDate) : null;
    const tags = fTags.length ? fTags : null;
    const payload = { title, description: fDesc.trim() || undefined, due_at: dueAt, all_day: allDay, tags };
    let targetId: string;
    if (editing) {
      await personalApi.updatePersonalItem(editing.id, { ...payload, status: fDone ? 'done' : 'pending' });
      targetId = editing.id;
    } else {
      const created = await personalApi.createPersonalItem(payload);
      targetId = created.id;
    }
    if (pendingImages.length > 0) {
      await personalApi.uploadPersonalImages(targetId, pendingImages.map((img) => ({ name: img.name, data: img.data })));
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

  // Open a calendar entry the same way the side panel does: personal → edit
  // form, schedule/planner → project deep-link, jira → external issue.
  const openEntry = (e: DayEntry) => {
    if (e.kind === 'personal') {
      const item = items.find((i) => i.id === e.id);
      if (item) openEdit(item);
    } else if (e.kind === 'jira') {
      if (e.url) window.open(e.url, '_blank', 'noopener,noreferrer');
    } else if (e.projectId && e.deepLinkTab) {
      navigate(`/projects/${e.projectId}?tab=${e.deepLinkTab}`);
    }
  };

  const selectedEntries = byDay.get(selectedDate) ?? [];

  return (
    <div ref={layoutRef} className="flex h-full overflow-hidden">
      {/* Calendar column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
            <HoverHelp title={t('agenda.refresh')} body={t('agenda.refreshHelp')}>
              <button onClick={load} className="btn-ghost p-1.5" aria-label="refresh">
                <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </HoverHelp>
            <button onClick={() => setShowCleanup(true)} className="btn-ghost p-1.5" title={t('agenda.cleanup')} aria-label="cleanup-memos">
              <Trash2 size={14} />
            </button>
            <button onClick={() => setShowJiraSettings(true)} className="btn-ghost p-1.5" title={t('agenda.jira.settings')} aria-label="jira-settings">
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Source legend / layer toggles */}
        <div className="px-6 pb-3 flex items-center gap-1.5 flex-wrap">
          {([
            { key: 'personal', label: t('agenda.source.personal'), color: 'var(--color-accent)' },
            { key: 'schedule', label: t('agenda.source.schedule'), color: 'var(--color-text-muted)' },
            { key: 'planner', label: t('agenda.source.planner'), color: 'var(--color-text-muted)' },
            ...(jiraOn ? [{ key: 'jira', label: t('agenda.source.jira'), color: JIRA_BLUE.fg }] : []),
          ] as Array<{ key: keyof typeof sources; label: string; color: string }>).map((s) => {
            const on = sources[s.key];
            return (
              <button
                key={s.key}
                onClick={() => setSources((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
                className="text-2xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-opacity"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: on ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', opacity: on ? 1 : 0.5 }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color, opacity: on ? 1 : 0.4 }} />
                {s.label}
              </button>
            );
          })}
          {jiraOn && jiraError && (
            <span className="text-2xs px-2 py-0.5 rounded-full cursor-help" style={{ backgroundColor: 'var(--color-status-error, #f87171)', color: '#fff' }} title={jiraError}>
              {t('agenda.jira.error')}
            </span>
          )}
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
          {view !== 'table' && (
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
              onQuickAdd={openAdd}
              onChipClick={(chip) => openEntry(chip.payload as DayEntry)}
            />
          )}

          {/* Table view */}
          {view === 'table' && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div
                className="grid items-center px-3 py-2 text-2xs uppercase tracking-wider"
                style={{ gridTemplateColumns: '1fr 150px 96px 72px', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
              >
                <span>{t('agenda.table.name')}</span>
                {([['date', 'agenda.table.date'], ['kind', 'agenda.table.kind'], ['status', 'agenda.table.status']] as const).map(([key, label]) => {
                  const active = sort.key === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSort((p) => ({ key, dir: p.key === key && p.dir === 'asc' ? 'desc' : 'asc' }))}
                      className="flex items-center gap-1 uppercase tracking-wider text-left hover:opacity-80 transition-opacity"
                      style={{ color: active ? 'var(--color-text-secondary)' : 'inherit' }}
                    >
                      <span>{t(label)}</span>
                      <span style={{ opacity: active ? 1 : 0 }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
                    </button>
                  );
                })}
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
                  else if (r.kind === 'jira' && r.url) window.open(r.url, '_blank', 'noopener');
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
                      <span className="px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: kindStyle(r.kind).bg, color: kindStyle(r.kind).fg }}>
                        {t(`agenda.kind.${r.kind}`)}
                      </span>
                    </span>
                    <span className="text-2xs truncate">
                      {(() => {
                        if (r.kind === 'jira') {
                          if (!r.status) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                          return <span className="px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: STATUS_PENDING.bg, color: STATUS_PENDING.fg }}>{r.status}</span>;
                        }
                        if (!r.status) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
                        const done = r.status === 'done';
                        const s = done ? STATUS_DONE : STATUS_PENDING;
                        return <span className="px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: s.bg, color: s.fg }}>{t(done ? 'agenda.status.done' : 'agenda.status.pending')}</span>;
                      })()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Drag handle to resize the side panel */}
      <div
        onPointerDown={startResize}
        className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-accent/40 transition-colors"
        style={{ backgroundColor: 'var(--color-border)' }}
        title={t('agenda.resizePanel')}
      />

      {/* Side panel: selected day + backlog */}
      <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: panelWidth }}>
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
                    <MoveToPlannerButton projects={projects} onMove={(pid) => moveToPlanner(item, pid)} title={t('agenda.moveToPlanner')} />
                    <button onClick={() => remove(item)} className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" title={t('agenda.delete')}>
                      <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                    </button>
                  </div>
                );
              }
              if (e.kind === 'jira') {
                const issue = jiraEntries.find((j) => j.key === e.id);
                return (
                  <div key={`jira-${e.id}`} className="group flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: JIRA_BLUE.bg, border: `1px solid ${JIRA_BLUE.bg}` }}>
                    <ExternalLink size={13} className="mt-0.5 flex-shrink-0" style={{ color: JIRA_BLUE.fg }} />
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }} title={e.title}>{e.title}</div>
                      <div className="text-2xs" style={{ color: JIRA_BLUE.fg }}>Jira</div>
                    </a>
                    {issue && (
                      <MoveToPlannerButton projects={projects} onMove={(pid) => jiraToPlanner(issue, pid)} title={t('agenda.importToPlanner')} />
                    )}
                    {issue && (
                      <button
                        onClick={() => personalApi.importJiraIssue(issue).then(load)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                        title={t('agenda.jira.import')}
                      >
                        <Download size={13} style={{ color: 'var(--color-text-muted)' }} />
                      </button>
                    )}
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
                  <MoveToPlannerButton projects={projects} onMove={(pid) => moveToPlanner(item, pid)} title={t('agenda.moveToPlanner')} />
                  <button onClick={() => remove(item)} className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                    <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Jira issues without a due date (assigned, open) */}
          {jiraOn && sources.jira && !activeTag && jiraEntries.some((j) => !j.duedate) && (
            <div>
              <h3 className="text-2xs uppercase tracking-wider mb-1.5" style={{ color: JIRA_BLUE.fg }}>{t('agenda.jira.noDue')}</h3>
              <div className="flex flex-col gap-1.5">
                {jiraEntries.filter((j) => !j.duedate).map((j) => (
                  <div key={`jira-nd-${j.key}`} className="group flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ backgroundColor: JIRA_BLUE.bg }}>
                    <ExternalLink size={13} className="mt-0.5 flex-shrink-0" style={{ color: JIRA_BLUE.fg }} />
                    <a href={j.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }} title={`${j.key} · ${j.summary}`}>{j.key} · {j.summary}</div>
                      <div className="text-2xs" style={{ color: JIRA_BLUE.fg }}>{j.status || 'Jira'}</div>
                    </a>
                    <MoveToPlannerButton projects={projects} onMove={(pid) => jiraToPlanner(j, pid)} title={t('agenda.importToPlanner')} />
                    <button onClick={() => personalApi.importJiraIssue(j).then(load)} className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" title={t('agenda.jira.import')}>
                      <Download size={13} style={{ color: 'var(--color-text-muted)' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
            <div className="flex-1 min-h-0 overflow-auto px-5 pt-2 pb-3">
              <div className={`flex flex-col gap-3 h-full ${expanded ? 'max-w-[820px] mx-auto w-full pt-2' : ''}`}>
                <input
                  autoFocus
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitForm(); } }}
                  placeholder={t('agenda.titlePlaceholder')}
                  className={`input-field font-semibold ${expanded ? 'text-2xl' : 'text-lg'}`}
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
                  onPaste={handlePaste}
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  placeholder={t('agenda.descPlaceholder')}
                  className="input-field flex-1 min-h-[280px] resize-y leading-relaxed"
                />
                {/* Images */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs btn-ghost"
                  >
                    <ImageIcon size={14} />
                    {t('plannerForm.addImage')}
                  </button>
                  <span className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>{t('plannerForm.pasteHint')}</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files) addImagesFromFiles(e.target.files); e.target.value = ''; }}
                />
                {totalImages > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {existingImages.map((img) => (
                      <div key={img.id} className="relative group">
                        <img
                          src={editing ? personalApi.getPersonalImageUrl(editing.id, img.id) : ''}
                          alt={img.originalName}
                          onClick={() => editing && setLightboxSrc(personalApi.getPersonalImageUrl(editing.id, img.id))}
                          className="h-20 w-20 object-cover rounded-lg cursor-zoom-in"
                          style={{ border: '1px solid var(--color-border)' }}
                        />
                        <button
                          type="button"
                          onClick={() => removeExistingImage(img.id)}
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} strokeWidth={3} />
                        </button>
                      </div>
                    ))}
                    {pendingImages.map((img) => (
                      <div key={img.id} className="relative group">
                        <img src={img.preview} alt={img.name} onClick={() => setLightboxSrc(img.preview)} className="h-20 w-20 object-cover rounded-lg cursor-zoom-in" style={{ border: '1px solid var(--color-border)' }} />
                        <button
                          type="button"
                          onClick={() => removePendingImage(img.id)}
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} strokeWidth={3} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <button onClick={closeForm} className="btn-ghost text-sm">{t('agenda.cancel')}</button>
              <button onClick={submitForm} disabled={!canSave} className="btn-primary text-sm disabled:opacity-40">{t('agenda.save')}</button>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {showJiraSettings && (
        <JiraSettingsModal
          initial={jiraConfig}
          onClose={() => setShowJiraSettings(false)}
          onSaved={(c) => { setJiraConfig(c); setShowJiraSettings(false); load(); }}
        />
      )}

      {showCleanup && (
        <CleanupModal
          items={items}
          defaultFrom={rangeStart}
          defaultTo={rangeEnd}
          onClose={() => setShowCleanup(false)}
          onDone={() => { setShowCleanup(false); load(); }}
        />
      )}
    </div>
  );
}

function CleanupModal({ items, defaultFrom, defaultTo, onClose, onDone }: {
  items: PersonalItem[];
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [doneOnly, setDoneOnly] = useState(false);
  const [includeBacklog, setIncludeBacklog] = useState(false);
  const [busy, setBusy] = useState(false);

  // Mirror the server-side matching so the preview count is exact.
  const matches = useCallback((p: PersonalItem) => {
    if (doneOnly && p.status !== 'done') return false;
    if (!p.due_at) return includeBacklog;
    if (!from || !to) return false;
    const d = p.due_at.slice(0, 10);
    return d >= from && d <= to;
  }, [from, to, doneOnly, includeBacklog]);

  const count = useMemo(() => items.filter(matches).length, [items, matches]);

  const confirm = async () => {
    if (count === 0) return;
    setBusy(true);
    try {
      await personalApi.bulkDeletePersonalItems({ from, to, done_only: doneOnly, include_backlog: includeBacklog });
      onDone();
    } catch { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-tooltip flex items-center justify-center p-6" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl shadow-xl flex flex-col" style={{ backgroundColor: 'var(--color-bg-card)', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-2">
          <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
            <Trash2 size={16} />{t('agenda.cleanup.title')}
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.cleanup.subtitle')}</p>
        </div>

        <div className="px-6 overflow-auto flex flex-col gap-4 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.cleanup.from')}</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field w-auto" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.cleanup.to')}</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-field w-auto" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={doneOnly} onChange={(e) => setDoneOnly(e.target.checked)} className="rounded" />
            {t('agenda.cleanup.doneOnly')}
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={includeBacklog} onChange={(e) => setIncludeBacklog(e.target.checked)} className="rounded" />
            {t('agenda.cleanup.includeBacklog')}
          </label>

          <div className="text-sm rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)', color: count > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
            {count > 0
              ? `${t('agenda.cleanup.previewLabel')}: ${count}${t('agenda.cleanup.unit')}`
              : t('agenda.cleanup.none')}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} className="btn-ghost text-sm">{t('agenda.cancel')}</button>
          <button
            onClick={confirm}
            disabled={busy || count === 0}
            className="btn-primary text-sm disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-status-error, #ef4444)' }}
          >
            {t('agenda.cleanup.confirm')}{count > 0 ? ` (${count})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function JiraSettingsModal({ initial, onClose, onSaved }: {
  initial: AgendaJiraConfig | null;
  onClose: () => void;
  onSaved: (c: AgendaJiraConfig) => void;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(!!initial?.enabled);
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [token, setToken] = useState('');
  const [assigneeMe, setAssigneeMe] = useState(initial?.assignee_me ?? true);
  const [includeDone, setIncludeDone] = useState(initial?.include_done ?? false);
  const [projects, setProjects] = useState(initial?.projects ?? '');
  const [extraJql, setExtraJql] = useState(initial?.extra_jql ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const payload = () => ({
    enabled, base_url: baseUrl.trim(), email: email.trim(), api_token: token || undefined,
    assignee_me: assigneeMe, include_done: includeDone, projects: projects.trim(), extra_jql: extraJql.trim(),
  });

  const test = async () => {
    setBusy(true); setResult(null);
    try {
      await personalApi.saveJiraConfig(payload());
      const r = await personalApi.testJiraConfig();
      setResult(r.ok ? `✓ ${r.user}` : `✗ ${r.error || 'failed'}`);
    } catch (e) {
      setResult(`✗ ${e instanceof Error ? e.message : 'failed'}`);
    } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { onSaved(await personalApi.saveJiraConfig(payload())); }
    catch { setBusy(false); }
  };

  const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';
  const labelCls = 'block text-xs font-medium mb-1';
  const hintCls = 'mt-1 text-2xs leading-relaxed';

  return (
    <div className="fixed inset-0 z-tooltip flex items-center justify-center p-6" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl shadow-xl flex flex-col" style={{ backgroundColor: 'var(--color-bg-card)', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-2">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('agenda.jira.settings')}</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.jira.subtitle')}</p>
        </div>

        <div className="px-6 overflow-auto flex flex-col gap-4 py-2">
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded" />
            {t('agenda.jira.enable')}
          </label>

          {/* 1. Site URL */}
          <div>
            <label className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.jira.baseUrlLabel')}</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://회사이름.atlassian.net" className="input-field text-sm font-mono" />
            <p className={hintCls} style={{ color: 'var(--color-text-muted)' }}>{t('agenda.jira.baseUrlHint')}</p>
          </div>

          {/* 2. Email */}
          <div>
            <label className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.jira.emailLabel')}</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="input-field text-sm" />
            <p className={hintCls} style={{ color: 'var(--color-text-muted)' }}>{t('agenda.jira.emailHint')}</p>
          </div>

          {/* 3. API token */}
          <div>
            <label className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.jira.tokenLabel')}</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={initial?.hasToken ? t('agenda.jira.tokenSaved') : t('agenda.jira.tokenPlaceholder')}
              className="input-field text-sm font-mono"
            />
            <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1.5 text-xs" style={{ color: 'var(--color-accent)' }}>
              <ExternalLink size={12} />
              {t('agenda.jira.tokenLink')}
            </a>
            <div className="mt-1.5 text-2xs leading-relaxed rounded-lg px-2.5 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
              <div>{t('agenda.jira.tokenStep1')}</div>
              <div>{t('agenda.jira.tokenStep2')}</div>
              <div>{t('agenda.jira.tokenStep3')}</div>
            </div>
          </div>

          {/* 4. Import criteria */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <label className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.jira.criteria')}</label>
            <p className={hintCls} style={{ color: 'var(--color-text-muted)', marginBottom: 8 }}>{t('agenda.jira.criteriaHint')}</p>

            <label className="flex items-center gap-2 text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={assigneeMe} onChange={(e) => setAssigneeMe(e.target.checked)} className="rounded" />
              {t('agenda.jira.assigneeMe')}
            </label>
            <label className="flex items-center gap-2 text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} className="rounded" />
              {t('agenda.jira.includeDone')}
            </label>

            <label className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.jira.projects')}</label>
            <input value={projects} onChange={(e) => setProjects(e.target.value)} placeholder="ABC, DEF" className="input-field text-sm font-mono" />
            <p className={hintCls} style={{ color: 'var(--color-text-muted)' }}>{t('agenda.jira.projectsHint')}</p>

            <label className={labelCls + ' mt-3'} style={{ color: 'var(--color-text-secondary)' }}>{t('agenda.jira.extraJql')}</label>
            <textarea
              value={extraJql}
              onChange={(e) => setExtraJql(e.target.value)}
              placeholder={'labels = urgent AND priority >= High'}
              rows={2}
              className="input-field text-sm font-mono resize-y"
            />
            <p className={hintCls} style={{ color: 'var(--color-text-muted)' }}>{t('agenda.jira.extraJqlHint')}</p>
          </div>

          {result && <p className="text-xs" style={{ color: result.startsWith('✓') ? 'var(--color-status-success, #4ade80)' : 'var(--color-status-error, #f87171)' }}>{result}</p>}
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={test} disabled={busy} className="btn-ghost text-sm disabled:opacity-40">{t('agenda.jira.test')}</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">{t('agenda.cancel')}</button>
            <button onClick={save} disabled={busy} className="btn-primary text-sm disabled:opacity-40">{t('agenda.save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
