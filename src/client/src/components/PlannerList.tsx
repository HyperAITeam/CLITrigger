import { useState, useMemo, useRef } from 'react';
import { Plus, ArrowUp, ArrowDown, LayoutList, Download, Upload } from 'lucide-react';
import type { PlannerItem as PlannerItemType, PlannerTag, ImageMeta } from '../types';
import PlannerItemRow from './PlannerItem';
import PlannerForm from './PlannerForm';
import PlannerConvertDialog from './PlannerConvertDialog';
import PlannerCalendar from './PlannerCalendar';
import EmptyState from './EmptyState';
import CursorContextMenu, { ctxMenuItemClass, isNativeContextMenuTarget } from './CursorContextMenu';
import { useI18n } from '../i18n';
import type { CalView } from './calendar/calendarShared';

type SortField = 'title' | 'tags' | 'priority' | 'due_date' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<string, number> = { pending: 0, in_progress: 1, done: 2, moved: 3 };

export interface PlannerItemsProps {
  plannerItems: PlannerItemType[];
  existingTags: PlannerTag[];
  projectCliTool?: string;
  onAddItem: (data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number }) => Promise<PlannerItemType>;
  onEditItem: (id: string, data: { title?: string; description?: string; tags?: string; due_date?: string; status?: string; priority?: number }) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onConvertToTodo: (id: string, data: Record<string, unknown>) => Promise<void>;
  onConvertToSchedule: (id: string, data: Record<string, unknown>) => Promise<void>;
  onConvertToSession: (id: string, data: Record<string, unknown>) => Promise<void>;
  onUpdateTag?: (name: string, data: { color?: string; new_name?: string }) => Promise<void>;
  onDeleteTag?: (name: string) => Promise<void>;
  onExport?: () => Promise<void>;
  onImport?: (file: File) => Promise<void>;
}

interface PlannerListProps extends PlannerItemsProps {
  // Controlled by the workspace sidebar (calendar views) — table is selected there too.
  view: CalView;
  onChangeView: (view: CalView) => void;
}

export default function PlannerList({
  plannerItems, existingTags, projectCliTool,
  onAddItem, onEditItem, onDeleteItem, onConvertToTodo, onConvertToSchedule, onConvertToSession,
  onUpdateTag, onDeleteTag, onExport, onImport,
  view, onChangeView,
}: PlannerListProps) {
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<PlannerItemType | null>(null);
  const [addDueDate, setAddDueDate] = useState<string | undefined>(undefined);
  const [filterTag, setFilterTag] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [convertItem, setConvertItem] = useState<PlannerItemType | null>(null);
  const [convertMode, setConvertMode] = useState<'todo' | 'schedule' | 'session'>('todo');
  const [ioBusy, setIoBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // Right-click on the list (empty area or a row) → "new item" menu.
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);

  const handleExportClick = async () => {
    if (!onExport || ioBusy) return;
    setIoBusy(true);
    try { await onExport(); } finally { setIoBusy(false); }
  };

  const handleImportClick = () => {
    if (!onImport || ioBusy) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onImport) return;
    setIoBusy(true);
    try { await onImport(file); } finally { setIoBusy(false); }
  };

  const isMarkdownFile = (file: File): boolean => {
    if (/\.(md|markdown)$/i.test(file.name)) return true;
    if (file.type === 'text/markdown') return true;
    return false;
  };

  const dragHasFiles = (e: React.DragEvent<HTMLDivElement>): boolean => {
    return Array.from(e.dataTransfer.types).includes('Files');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onImport || ioBusy) return;
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onImport || ioBusy) return;
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onImport) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!onImport) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (ioBusy) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!isMarkdownFile(file)) {
      window.alert(t('planner.dropInvalidFile'));
      return;
    }
    setIoBusy(true);
    try { await onImport(file); } finally { setIoBusy(false); }
  };

  const tagNames = useMemo(() => existingTags.map(t => t.name), [existingTags]);
  const tagColorMap = useMemo(() => new Map(existingTags.map(t => [t.name, t.color])), [existingTags]);

  // Filter + Sort
  const filteredItems = useMemo(() => {
    let items = plannerItems.filter((item) => {
      if (filterStatus && item.status !== filterStatus) return false;
      if (filterTag) {
        const tags: string[] = item.tags ? (() => { try { return JSON.parse(item.tags!); } catch { return []; } })() : [];
        if (!tags.includes(filterTag)) return false;
      }
      return true;
    });

    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'tags': {
          const ta = a.tags ? (() => { try { return JSON.parse(a.tags!).join(','); } catch { return ''; } })() : '';
          const tb = b.tags ? (() => { try { return JSON.parse(b.tags!).join(','); } catch { return ''; } })() : '';
          cmp = (ta || 'zzz').localeCompare(tb || 'zzz');
          break;
        }
        case 'priority':
          cmp = a.priority - b.priority;
          break;
        case 'due_date': {
          const da = a.due_date || '9999';
          const db = b.due_date || '9999';
          cmp = da.localeCompare(db);
          break;
        }
        case 'status':
          cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
          break;
        case 'created_at':
          cmp = a.created_at.localeCompare(b.created_at);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return items;
  }, [plannerItems, filterTag, filterStatus, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'priority' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ArrowUp size={10} className="inline ml-0.5" />
      : <ArrowDown size={10} className="inline ml-0.5" />;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
          {t('planner.title')}
          <span className="ml-1 text-warm-400">{plannerItems.length}</span>
        </h2>

        <div className="flex items-center gap-2 min-w-0">
          {/* Calendar sub-views (month/week/day). 'table' (목록) is chosen in the sidebar. */}
          {view !== 'table' && (
          <div className="flex gap-0.5 p-0.5 rounded-lg shrink-0" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
            {(['month', 'week', 'day'] as CalView[]).map((v) => (
              <button
                key={v}
                onClick={() => onChangeView(v)}
                className="px-2.5 py-1 text-xs rounded-md transition-all"
                style={view === v
                  ? { backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)', fontWeight: 600 }
                  : { color: 'var(--color-text-tertiary)' }}
              >
                {t(`agenda.view.${v}`)}
              </button>
            ))}
          </div>
          )}

          <select className="input-field text-xs py-1.5 px-2 w-auto max-w-[10rem] shrink" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
            <option value="">{t('planner.filterTag')}</option>
            {tagNames.map((tag) => (<option key={tag} value={tag}>{tag}</option>))}
          </select>

          <select className="input-field text-xs py-1.5 px-2 w-auto max-w-[10rem] shrink" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">{t('planner.filterStatus')}</option>
            <option value="pending">{t('plannerStatus.pending')}</option>
            <option value="in_progress">{t('plannerStatus.in_progress')}</option>
            <option value="done">{t('plannerStatus.done')}</option>
            <option value="moved">{t('plannerStatus.moved')}</option>
          </select>

          {onExport && (
            <button
              onClick={handleExportClick}
              disabled={ioBusy || plannerItems.length === 0}
              className="btn-secondary text-xs py-2 whitespace-nowrap shrink-0 disabled:opacity-50"
              title={t('planner.exportTooltip')}
            >
              <Download size={14} className="inline-block shrink-0" />
              {t('planner.export')}
            </button>
          )}
          {onImport && (
            <>
              <button
                onClick={handleImportClick}
                disabled={ioBusy}
                className="btn-secondary text-xs py-2 whitespace-nowrap shrink-0 disabled:opacity-50"
                title={t('planner.importTooltip')}
              >
                <Upload size={14} className="inline-block shrink-0" />
                {t('planner.import')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,text/markdown"
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}

          {!showForm && !editItem && (
            <button onClick={() => setShowForm(true)} className="btn-primary text-xs py-2 whitespace-nowrap shrink-0">
              <Plus size={14} className="inline-block shrink-0" />
              {t('planner.add')}
            </button>
          )}
        </div>
      </div>

      {/* Inline form */}
      {(showForm || editItem) && (
        <div className="mb-5">
          <PlannerForm
            existingTags={existingTags}
            editItem={editItem}
            initialDueDate={addDueDate}
            onSave={async (data) => {
              if (editItem) {
                await onEditItem(editItem.id, data);
                setEditItem(null);
                return;
              } else {
                const item = await onAddItem(data);
                setShowForm(false);
                setAddDueDate(undefined);
                return item;
              }
            }}
            onCancel={() => { setShowForm(false); setEditItem(null); setAddDueDate(undefined); }}
            onUpdateTag={onUpdateTag}
          />
        </div>
      )}

      {/* Table = list; else calendar (month/week/day) */}
      {view === 'table' ? (
      <div
        className="card relative"
        onDragEnter={onImport ? handleDragEnter : undefined}
        onDragOver={onImport ? handleDragOver : undefined}
        onDragLeave={onImport ? handleDragLeave : undefined}
        onDrop={onImport ? handleDrop : undefined}
        onContextMenu={(e) => {
          if (isNativeContextMenuTarget(e)) return;
          e.preventDefault();
          setListMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {isDragOver && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none rounded-xl border-2 border-dashed"
            style={{
              borderColor: 'var(--color-accent, #3b82f6)',
              backgroundColor: 'var(--color-bg-secondary, rgba(59, 130, 246, 0.08))',
              backdropFilter: 'blur(2px)',
            }}
          >
            <div className="text-center">
              <Upload size={32} className="inline-block mb-2" style={{ color: 'var(--color-accent, #3b82f6)' }} />
              <div className="text-sm font-semibold">{t('planner.dropHint')}</div>
              <div className="text-xs text-warm-500 mt-1">{t('planner.dropHintSub')}</div>
            </div>
          </div>
        )}
        {/* Table header — clickable for sort */}
        <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-t-xl select-none" style={{ backgroundColor: 'var(--color-bg-tertiary)', borderBottom: '1px solid var(--color-border-muted)' }}>
          <div className="w-[14px] flex-shrink-0" />
          <div className="flex-1 text-2xs font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('title')}>
            {t('planner.col.title')}<SortIcon field="title" />
          </div>
          <div className="w-[160px] text-2xs font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('tags')}>
            {t('planner.col.tags')}<SortIcon field="tags" />
          </div>
          <div className="w-12 text-center text-2xs font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('priority')}>
            {t('plannerForm.priority')}<SortIcon field="priority" />
          </div>
          <div className="hidden md:block w-20 text-right text-2xs font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('due_date')}>
            {t('planner.col.dueDate')}<SortIcon field="due_date" />
          </div>
          <div className="w-16 text-2xs font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('status')}>
            {t('planner.col.status')}<SortIcon field="status" />
          </div>
          <div className="w-8"></div>
        </div>

        {/* Items */}
        {filteredItems.length === 0 ? (
          <EmptyState icon={LayoutList} title={t('planner.empty')} description={t('planner.emptyHint')} />
        ) : (
          filteredItems.map((item, index) => (
            <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${index * 20}ms` }}>
              <PlannerItemRow
                item={item}
                tagColors={tagColorMap}
                existingTags={tagNames}
                onSave={async (id, data) => { await onEditItem(id, data as Record<string, string | number | undefined>); }}
                onDelete={() => onDeleteItem(item.id)}
                onConvertToTodo={() => { setConvertItem(item); setConvertMode('todo'); }}
                onConvertToSchedule={() => { setConvertItem(item); setConvertMode('schedule'); }}
                onConvertToSession={() => { setConvertItem(item); setConvertMode('session'); }}
                onUpdateTag={onUpdateTag}
              />
            </div>
          ))
        )}
      </div>
      ) : (
        <PlannerCalendar
          view={view}
          items={filteredItems}
          tagColors={tagColorMap}
          onQuickAdd={(dateKey) => { setEditItem(null); setAddDueDate(dateKey); setShowForm(true); }}
          onEditItem={(item) => { setShowForm(false); setEditItem(item); }}
          onConvert={(item, mode) => { setConvertItem(item); setConvertMode(mode); }}
          onDeleteItem={onDeleteItem}
        />
      )}

      {/* Convert dialog */}
      {convertItem && (
        <PlannerConvertDialog
          item={convertItem}
          mode={convertMode}
          projectCliTool={projectCliTool}
          onConvert={async (data) => {
            if (convertMode === 'todo') {
              await onConvertToTodo(convertItem.id, data);
            } else if (convertMode === 'session') {
              await onConvertToSession(convertItem.id, data);
            } else {
              await onConvertToSchedule(convertItem.id, data);
            }
            setConvertItem(null);
          }}
          onClose={() => setConvertItem(null)}
        />
      )}

      {listMenu && (
        <CursorContextMenu x={listMenu.x} y={listMenu.y} onClose={() => setListMenu(null)}>
          <button
            type="button"
            className={ctxMenuItemClass}
            onClick={() => { setEditItem(null); setAddDueDate(undefined); setShowForm(true); }}
          >
            <Plus size={14} />
            {t('planner.add')}
          </button>
        </CursorContextMenu>
      )}
    </div>
  );
}
