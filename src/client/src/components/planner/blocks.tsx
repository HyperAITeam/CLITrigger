import { useState, useEffect, useCallback, useMemo } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { CheckSquare, Square, Trash2, Terminal, Clock, ArrowRight, Plus } from 'lucide-react';
import type { PlannerItem } from '../../types';
import * as plannerApi from '../../api/planner';
import { useI18n } from '../../i18n';
import PlannerCalendar from '../PlannerCalendar';
import { usePlannerPage } from './PlannerPageContext';

// Hook: load + mutate the current page's tasks. Shared by both blocks.
function usePageTasks() {
  const { pageId, projectId } = usePlannerPage();
  const [items, setItems] = useState<PlannerItem[]>([]);

  const reload = useCallback(() => {
    plannerApi.getPlannerPageItems(pageId).then(setItems);
  }, [pageId]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (data: { title: string; due_date?: string }) => {
    const item = await plannerApi.createPlannerItem(projectId, { ...data, page_id: pageId });
    setItems((prev) => [...prev, item]);
    return item;
  }, [projectId, pageId]);

  const update = useCallback(async (id: string, patch: Parameters<typeof plannerApi.updatePlannerItem>[1]) => {
    const updated = await plannerApi.updatePlannerItem(id, patch);
    setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await plannerApi.deletePlannerItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return { items, reload, add, update, remove };
}

// ── Task checklist block ──────────────────────────────────────────────
function TaskListBlockView() {
  const { t } = useI18n();
  const { openConvert } = usePlannerPage();
  const { items, reload, add, update, remove } = usePageTasks();
  const [newTitle, setNewTitle] = useState('');

  const submitNew = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle('');
    await add({ title });
  };

  return (
    <div contentEditable={false} className="my-1 rounded-lg" style={{ border: '1px solid var(--color-border-muted)' }}>
      {items.map((item) => {
        const done = item.status === 'done';
        return (
          <div key={item.id} className="group flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
            <button onClick={() => update(item.id, { status: done ? 'pending' : 'done' })} className="text-warm-400 hover:text-accent flex-shrink-0">
              {done ? <CheckSquare size={16} className="text-emerald-500" /> : <Square size={16} />}
            </button>
            <input
              defaultValue={item.title}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== item.title) update(item.id, { title: v }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className={`flex-1 bg-transparent text-sm outline-none ${done ? 'line-through text-warm-400' : ''}`}
              style={{ color: done ? undefined : 'var(--color-text-primary)' }}
            />
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button title={t('planner.convertToTask')} onClick={() => openConvert(item, 'todo', reload)} className="p-1 text-warm-400 hover:text-warm-600"><ArrowRight size={13} /></button>
              <button title={t('planner.convertToSchedule')} onClick={() => openConvert(item, 'schedule', reload)} className="p-1 text-warm-400 hover:text-warm-600"><Clock size={13} /></button>
              <button title={t('planner.convertToTerminal')} onClick={() => openConvert(item, 'session', reload)} className="p-1 text-warm-400 hover:text-warm-600"><Terminal size={13} /></button>
              <button title={t('planner.delete')} onClick={() => remove(item.id)} className="p-1 text-warm-400 hover:text-red-500"><Trash2 size={13} /></button>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Plus size={15} className="text-warm-400 flex-shrink-0" />
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } }}
          onBlur={submitNew}
          placeholder={t('planner.block.addTask')}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-warm-300"
          style={{ color: 'var(--color-text-primary)' }}
        />
      </div>
    </div>
  );
}

export const taskListBlock = createReactBlockSpec(
  { type: 'tasklist', propSchema: {}, content: 'none' },
  { render: () => <TaskListBlockView /> },
);

// ── Calendar block ────────────────────────────────────────────────────
function CalendarBlockView() {
  const { openConvert, existingTags } = usePlannerPage();
  const { items, reload, add, remove } = usePageTasks();
  const tagColors = useMemo(() => new Map(existingTags.map((tg) => [tg.name, tg.color])), [existingTags]);

  return (
    <div contentEditable={false} className="my-1">
      <PlannerCalendar
        view="month"
        items={items}
        tagColors={tagColors}
        onQuickAdd={(dateKey) => add({ title: 'New task', due_date: dateKey })}
        onEditItem={() => { /* v1: no inline edit in calendar block */ }}
        onConvert={(item, mode) => openConvert(item, mode, reload)}
        onDeleteItem={(id) => remove(id)}
      />
    </div>
  );
}

export const calendarBlock = createReactBlockSpec(
  { type: 'calendar', propSchema: {}, content: 'none' },
  { render: () => <CalendarBlockView /> },
);
