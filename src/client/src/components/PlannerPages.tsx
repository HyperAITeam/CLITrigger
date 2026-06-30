import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, FileText } from 'lucide-react';
import type { PlannerPage } from '../types';
import * as plannerApi from '../api/planner';
import { useI18n } from '../i18n';
import EmptyState from './EmptyState';
import PlannerPageEditor from './PlannerPageEditor';

const SAVE_DEBOUNCE_MS = 800;

interface PlannerPagesProps {
  projectId: string;
}

export default function PlannerPages({ projectId }: PlannerPagesProps) {
  const { t } = useI18n();
  const [pages, setPages] = useState<PlannerPage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<PlannerPage | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Latest unsaved values + debounce timer for the active page.
  const pendingRef = useRef<{ title: string; content: string | null }>({ title: '', content: null });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load page list on mount / project change.
  useEffect(() => {
    plannerApi.getPlannerPages(projectId).then((list) => {
      setPages(list);
      setActiveId((cur) => cur ?? list[0]?.id ?? null);
    });
  }, [projectId]);

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const id = activeId;
    if (!id) return;
    const { title, content } = pendingRef.current;
    setSaveState('saving');
    await plannerApi.updatePlannerPage(id, { title, content: content ?? undefined });
    setSaveState('saved');
  }, [activeId]);

  // Load full content when the active page changes (flush prior edits first).
  useEffect(() => {
    if (!activeId) { setActive(null); return; }
    let cancelled = false;
    plannerApi.getPlannerPage(activeId).then((page) => {
      if (cancelled) return;
      setActive(page);
      pendingRef.current = { title: page.title, content: page.content ?? null };
      setSaveState('idle');
    });
    return () => { cancelled = true; };
  }, [activeId]);

  // Flush any pending save on unmount.
  useEffect(() => () => { if (timerRef.current) flush(); }, [flush]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState('saving');
    timerRef.current = setTimeout(() => { flush(); }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  const handleTitleChange = (title: string) => {
    pendingRef.current.title = title;
    setActive((p) => (p ? { ...p, title } : p));
    setPages((list) => list.map((p) => (p.id === activeId ? { ...p, title } : p)));
    scheduleSave();
  };

  const handleContentChange = (content: string) => {
    pendingRef.current.content = content;
    scheduleSave();
  };

  const handleNewPage = async () => {
    if (timerRef.current) await flush();
    const page = await plannerApi.createPlannerPage(projectId, t('planner.pages.untitled'));
    setPages((list) => [...list, page]);
    setActiveId(page.id);
  };

  const handleSelect = async (id: string) => {
    if (id === activeId) return;
    if (timerRef.current) await flush();
    setActiveId(id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('planner.pages.deleteConfirm'))) return;
    await plannerApi.deletePlannerPage(id);
    setPages((list) => {
      const next = list.filter((p) => p.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  return (
    <div className="card flex overflow-hidden" style={{ minHeight: '70vh' }}>
      {/* Sidebar: page list */}
      <div className="w-56 flex-shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--color-border-muted)' }}>
        <button
          onClick={handleNewPage}
          className="flex items-center gap-1.5 m-2 px-3 py-1.5 rounded-lg text-xs font-medium btn-secondary"
        >
          <Plus size={14} /> {t('planner.pages.new')}
        </button>
        <div className="flex-1 overflow-y-auto px-1">
          {pages.map((p) => (
            <div
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${p.id === activeId ? 'bg-warm-100' : 'hover:bg-warm-50'}`}
              style={p.id === activeId ? { backgroundColor: 'var(--color-bg-tertiary)' } : undefined}
            >
              <FileText size={13} className="text-warm-400 flex-shrink-0" />
              <span className="flex-1 text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                {p.title || t('planner.pages.untitled')}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                className="opacity-0 group-hover:opacity-100 text-warm-400 hover:text-red-500 transition-all flex-shrink-0"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main: editor */}
      <div className="flex-1 min-w-0 flex flex-col">
        {active ? (
          <>
            <div className="flex items-center gap-3 px-6 pt-5 pb-2">
              <input
                value={active.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder={t('planner.pages.untitled')}
                className="flex-1 bg-transparent text-2xl font-bold outline-none"
                style={{ color: 'var(--color-text-primary)' }}
              />
              <span className="text-2xs text-warm-400 flex-shrink-0">
                {saveState === 'saving' ? t('planner.pages.saving') : saveState === 'saved' ? t('planner.pages.saved') : ''}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto pb-6">
              <PlannerPageEditor
                key={active.id}
                initialContent={active.content ?? null}
                onChange={handleContentChange}
              />
            </div>
          </>
        ) : (
          <EmptyState
            icon={FileText}
            title={t('planner.pages.empty')}
            description={t('planner.pages.emptyHint')}
            action={{ label: t('planner.pages.new'), onClick: handleNewPage, icon: Plus }}
            size="lg"
            className="m-auto"
          />
        )}
      </div>
    </div>
  );
}
