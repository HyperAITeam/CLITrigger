import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { PlannerItem as PlannerItemType } from '../types';
import PlannerItemRow from './PlannerItem';
import PlannerForm from './PlannerForm';
import PlannerConvertDialog from './PlannerConvertDialog';
import { useI18n } from '../i18n';

interface PlannerListProps {
  plannerItems: PlannerItemType[];
  existingTags: string[];
  projectCliTool?: string;
  projectCliModel?: string;
  onAddItem: (data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number }) => Promise<void>;
  onEditItem: (id: string, data: { title?: string; description?: string; tags?: string; due_date?: string; status?: string; priority?: number }) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onConvertToTodo: (id: string, data: Record<string, unknown>) => Promise<void>;
  onConvertToSchedule: (id: string, data: Record<string, unknown>) => Promise<void>;
}

export default function PlannerList({
  plannerItems, existingTags, projectCliTool, projectCliModel,
  onAddItem, onEditItem, onDeleteItem, onConvertToTodo, onConvertToSchedule,
}: PlannerListProps) {
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<PlannerItemType | null>(null);
  const [filterTag, setFilterTag] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [convertItem, setConvertItem] = useState<PlannerItemType | null>(null);
  const [convertMode, setConvertMode] = useState<'todo' | 'schedule'>('todo');

  // Collect all unique tags from items
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    plannerItems.forEach((item) => {
      if (item.tags) {
        try { JSON.parse(item.tags).forEach((t: string) => tagSet.add(t)); } catch {}
      }
    });
    // Merge with existingTags (from API)
    existingTags.forEach((t) => tagSet.add(t));
    return Array.from(tagSet).sort();
  }, [plannerItems, existingTags]);

  // Filter items
  const filteredItems = useMemo(() => {
    return plannerItems.filter((item) => {
      if (filterStatus && item.status !== filterStatus) return false;
      if (filterTag) {
        const tags: string[] = item.tags ? (() => { try { return JSON.parse(item.tags!); } catch { return []; } })() : [];
        if (!tags.includes(filterTag)) return false;
      }
      return true;
    });
  }, [plannerItems, filterTag, filterStatus]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
          {t('planner.title')}
          <span className="ml-1 text-warm-400">{plannerItems.length}</span>
        </h2>

        <div className="flex items-center gap-2">
          {/* Tag filter */}
          <select
            className="input-field text-xs py-1.5 px-2"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
          >
            <option value="">{t('planner.filterTag')}</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>

          {/* Status filter */}
          <select
            className="input-field text-xs py-1.5 px-2"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">{t('planner.filterStatus')}</option>
            <option value="pending">{t('plannerStatus.pending')}</option>
            <option value="in_progress">{t('plannerStatus.in_progress')}</option>
            <option value="done">{t('plannerStatus.done')}</option>
            <option value="moved">{t('plannerStatus.moved')}</option>
          </select>

          {!showForm && !editItem && (
            <button onClick={() => setShowForm(true)} className="btn-primary text-xs py-2">
              <Plus size={14} />
              {t('planner.add')}
            </button>
          )}
        </div>
      </div>

      {/* Inline form */}
      {(showForm || editItem) && (
        <div className="mb-5">
          <PlannerForm
            existingTags={allTags}
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
          />
        </div>
      )}

      {/* Table */}
      <div className="card">
        {/* Table header */}
        <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-t-xl" style={{ backgroundColor: 'var(--color-bg-tertiary)', borderBottom: '1px solid var(--color-border-muted)' }}>
          <div className="flex-1 text-[10px] font-semibold text-warm-500 uppercase tracking-wider">{t('planner.col.title')}</div>
          <div className="w-[160px] text-[10px] font-semibold text-warm-500 uppercase tracking-wider">{t('planner.col.tags')}</div>
          <div className="w-12 text-center text-[10px] font-semibold text-warm-500 uppercase tracking-wider">{t('plannerForm.priority')}</div>
          <div className="hidden md:block w-20 text-right text-[10px] font-semibold text-warm-500 uppercase tracking-wider">{t('planner.col.dueDate')}</div>
          <div className="w-16 text-[10px] font-semibold text-warm-500 uppercase tracking-wider">{t('planner.col.status')}</div>
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
                onEdit={() => { setEditItem(item); setShowForm(false); }}
                onDelete={() => onDeleteItem(item.id)}
                onConvertToTodo={() => { setConvertItem(item); setConvertMode('todo'); }}
                onConvertToSchedule={() => { setConvertItem(item); setConvertMode('schedule'); }}
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
