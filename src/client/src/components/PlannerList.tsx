import { useState, useMemo } from 'react';
import { Plus, ArrowUp, ArrowDown } from 'lucide-react';
import type { PlannerItem as PlannerItemType, PlannerTag } from '../types';
import PlannerItemRow from './PlannerItem';
import PlannerForm from './PlannerForm';
import PlannerConvertDialog from './PlannerConvertDialog';
import { useI18n } from '../i18n';

type SortField = 'title' | 'tags' | 'priority' | 'due_date' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<string, number> = { pending: 0, in_progress: 1, done: 2, moved: 3 };

interface PlannerListProps {
  plannerItems: PlannerItemType[];
  existingTags: PlannerTag[];
  projectCliTool?: string;
  projectCliModel?: string;
  onAddItem: (data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number }) => Promise<void>;
  onEditItem: (id: string, data: { title?: string; description?: string; tags?: string; due_date?: string; status?: string; priority?: number }) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onConvertToTodo: (id: string, data: Record<string, unknown>) => Promise<void>;
  onConvertToSchedule: (id: string, data: Record<string, unknown>) => Promise<void>;
  onUpdateTag?: (name: string, data: { color?: string; new_name?: string }) => Promise<void>;
  onDeleteTag?: (name: string) => Promise<void>;
}

export default function PlannerList({
  plannerItems, existingTags, projectCliTool, projectCliModel,
  onAddItem, onEditItem, onDeleteItem, onConvertToTodo, onConvertToSchedule,
  onUpdateTag, onDeleteTag,
}: PlannerListProps) {
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<PlannerItemType | null>(null);
  const [filterTag, setFilterTag] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [convertItem, setConvertItem] = useState<PlannerItemType | null>(null);
  const [convertMode, setConvertMode] = useState<'todo' | 'schedule'>('todo');

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

        <div className="flex items-center gap-2">
          <select className="input-field text-xs py-1.5 px-2" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
            <option value="">{t('planner.filterTag')}</option>
            {tagNames.map((tag) => (<option key={tag} value={tag}>{tag}</option>))}
          </select>

          <select className="input-field text-xs py-1.5 px-2" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">{t('planner.filterStatus')}</option>
            <option value="pending">{t('plannerStatus.pending')}</option>
            <option value="in_progress">{t('plannerStatus.in_progress')}</option>
            <option value="done">{t('plannerStatus.done')}</option>
            <option value="moved">{t('plannerStatus.moved')}</option>
          </select>

          {!showForm && !editItem && (
            <button onClick={() => setShowForm(true)} className="btn-primary text-xs py-2 whitespace-nowrap">
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
            onSave={async (data) => {
              if (editItem) {
                await onEditItem(editItem.id, data);
                setEditItem(null);
              } else {
                await onAddItem(data);
                setShowForm(false);
              }
            }}
            onCancel={() => { setShowForm(false); setEditItem(null); }}
            onUpdateTag={onUpdateTag}
          />
        </div>
      )}

      {/* Table */}
      <div className="card">
        {/* Table header — clickable for sort */}
        <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-t-xl select-none" style={{ backgroundColor: 'var(--color-bg-tertiary)', borderBottom: '1px solid var(--color-border-muted)' }}>
          <div className="w-[14px] flex-shrink-0" />
          <div className="flex-1 text-[10px] font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('title')}>
            {t('planner.col.title')}<SortIcon field="title" />
          </div>
          <div className="w-[160px] text-[10px] font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('tags')}>
            {t('planner.col.tags')}<SortIcon field="tags" />
          </div>
          <div className="w-12 text-center text-[10px] font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('priority')}>
            {t('plannerForm.priority')}<SortIcon field="priority" />
          </div>
          <div className="hidden md:block w-20 text-right text-[10px] font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('due_date')}>
            {t('planner.col.dueDate')}<SortIcon field="due_date" />
          </div>
          <div className="w-16 text-[10px] font-semibold text-warm-500 uppercase tracking-wider cursor-pointer hover:text-warm-700 transition-colors" onClick={() => toggleSort('status')}>
            {t('planner.col.status')}<SortIcon field="status" />
          </div>
          <div className="w-8"></div>
        </div>

        {/* Items */}
        {filteredItems.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-warm-600 font-medium">{t('planner.empty')}</p>
            <p className="text-warm-400 text-sm mt-1">{t('planner.emptyHint')}</p>
          </div>
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
                onUpdateTag={onUpdateTag}
              />
            </div>
          ))
        )}
      </div>

      {/* Convert dialog */}
      {convertItem && (
        <PlannerConvertDialog
          item={convertItem}
          mode={convertMode}
          projectCliTool={projectCliTool}
          projectCliModel={projectCliModel}
          onConvert={async (data) => {
            if (convertMode === 'todo') {
              await onConvertToTodo(convertItem.id, data);
            } else {
              await onConvertToSchedule(convertItem.id, data);
            }
            setConvertItem(null);
          }}
          onClose={() => setConvertItem(null)}
        />
      )}
    </div>
  );
}
