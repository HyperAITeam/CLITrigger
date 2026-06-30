import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, FileText, Calendar, List } from 'lucide-react';
import type { PlannerPage } from '../types';
import type { CalView } from './calendar/calendarShared';
import * as plannerApi from '../api/planner';
import { useI18n } from '../i18n';
import PlannerList, { type PlannerItemsProps } from './PlannerList';
import PlannerPageView from './PlannerPageView';
import Modal from './Modal';
import { PAGE_TEMPLATES, type PageTemplate } from './planner/pageTemplates';

interface PlannerWorkspaceProps extends PlannerItemsProps {
  projectId: string;
}

type Selection = { kind: 'work' } | { kind: 'page'; id: string };

export default function PlannerWorkspace({ projectId, ...itemProps }: PlannerWorkspaceProps) {
  const { t } = useI18n();
  const [pages, setPages] = useState<PlannerPage[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: 'work' });
  const [workView, setWorkView] = useState<CalView>('table');
  const [showPicker, setShowPicker] = useState(false);
  const didInit = useRef(false);

  // Page-centric: land on the first page if any exist (once, on first load).
  useEffect(() => {
    plannerApi.getPlannerPages(projectId).then((list) => {
      setPages(list);
      if (!didInit.current) {
        didInit.current = true;
        if (list.length > 0) setSelection({ kind: 'page', id: list[0].id });
      }
    });
  }, [projectId]);

  const handleNewPage = async (template: PageTemplate) => {
    setShowPicker(false);
    const page = await plannerApi.createPlannerPage(
      projectId,
      template.title || t('planner.pages.untitled'),
      template.blocks ? JSON.stringify(template.blocks) : undefined,
    );
    setPages((list) => [...list, page]);
    setSelection({ kind: 'page', id: page.id });
  };

  const handleDeletePage = async (id: string) => {
    if (!confirm(t('planner.pages.deleteConfirm'))) return;
    await plannerApi.deletePlannerPage(id);
    setPages((list) => list.filter((p) => p.id !== id));
    setSelection((cur) => (cur.kind === 'page' && cur.id === id ? { kind: 'work' } : cur));
  };

  const handleTitleChange = useCallback((pageId: string, title: string) => {
    setPages((list) => list.map((p) => (p.id === pageId ? { ...p, title } : p)));
  }, []);

  const selectCalendar = () => {
    setSelection({ kind: 'work' });
    setWorkView((v) => (v === 'table' ? 'month' : v));
  };
  const selectList = () => {
    setSelection({ kind: 'work' });
    setWorkView('table');
  };

  const workActive = selection.kind === 'work';
  const calActive = workActive && workView !== 'table';
  const listActive = workActive && workView === 'table';

  const navItem = (active: boolean, onClick: () => void, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <div
      onClick={onClick}
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${active ? '' : 'hover:bg-warm-50'}`}
      style={active ? { backgroundColor: 'var(--color-bg-tertiary)' } : undefined}
    >
      {icon}
      <span className="flex-1 text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
      {extra}
    </div>
  );

  return (
    <div className="flex gap-4" style={{ minHeight: '70vh' }}>
      {/* Unified sidebar: pages (primary) + work roll-up views (secondary) */}
      <div className="w-52 flex-shrink-0 flex flex-col card p-2 overflow-y-auto">
        <div className="flex items-center justify-between px-2.5 pt-1 pb-1">
          <span className="text-2xs font-semibold uppercase tracking-wider text-warm-400">{t('planner.view.pages')}</span>
          <button onClick={() => setShowPicker(true)} className="text-warm-400 hover:text-warm-600 transition-colors" title={t('planner.pages.new')}>
            <Plus size={14} />
          </button>
        </div>
        {pages.map((p) => navItem(
          selection.kind === 'page' && selection.id === p.id,
          () => setSelection({ kind: 'page', id: p.id }),
          <FileText size={13} className="text-warm-400 flex-shrink-0" />,
          p.title || t('planner.pages.untitled'),
          <button
            onClick={(e) => { e.stopPropagation(); handleDeletePage(p.id); }}
            className="opacity-0 group-hover:opacity-100 text-warm-400 hover:text-red-500 transition-all flex-shrink-0"
          >
            <Trash2 size={13} />
          </button>,
        ))}

        <div className="px-2.5 pt-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-warm-400">
          {t('planner.view.all')}
        </div>
        {navItem(calActive, selectCalendar, <Calendar size={14} className="text-warm-400 flex-shrink-0" />, t('planner.nav.calendar'))}
        {navItem(listActive, selectList, <List size={14} className="text-warm-400 flex-shrink-0" />, t('planner.nav.list'))}
      </div>

      {/* Main pane */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selection.kind === 'page' ? (
          <div className="card flex flex-col flex-1">
            <PlannerPageView
              key={selection.id}
              pageId={selection.id}
              projectId={projectId}
              projectCliTool={itemProps.projectCliTool}
              existingTags={itemProps.existingTags}
              onTitleChange={handleTitleChange}
              onConvertToTodo={itemProps.onConvertToTodo}
              onConvertToSchedule={itemProps.onConvertToSchedule}
              onConvertToSession={itemProps.onConvertToSession}
            />
          </div>
        ) : (
          <PlannerList {...itemProps} view={workView} onChangeView={setWorkView} />
        )}
      </div>

      <Modal open={showPicker} onClose={() => setShowPicker(false)} size="md">
        <div className="p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
            {t('planner.pages.newTemplate')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {PAGE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => handleNewPage(tpl)}
                className="text-left p-3 rounded-lg border transition-colors hover:bg-warm-50"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{t(tpl.labelKey)}</div>
                <div className="text-2xs text-warm-400 mt-0.5">{t(tpl.descKey)}</div>
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
