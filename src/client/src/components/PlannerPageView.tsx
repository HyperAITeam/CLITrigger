import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlannerPage, PlannerItem, PlannerTag } from '../types';
import * as plannerApi from '../api/planner';
import { useI18n } from '../i18n';
import PlannerPageEditor from './PlannerPageEditor';
import PlannerConvertDialog from './PlannerConvertDialog';
import { PlannerPageProvider, type ConvertMode } from './planner/PlannerPageContext';

const SAVE_DEBOUNCE_MS = 800;

interface PlannerPageViewProps {
  pageId: string;
  projectId: string;
  projectCliTool?: string;
  existingTags: PlannerTag[];
  onTitleChange: (pageId: string, title: string) => void;
  onConvertToTodo: (id: string, data: Record<string, unknown>) => Promise<void>;
  onConvertToSchedule: (id: string, data: Record<string, unknown>) => Promise<void>;
  onConvertToSession: (id: string, data: Record<string, unknown>) => Promise<void>;
}

// Self-contained page editor: loads its own content, autosaves (debounced),
// flushes on unmount, and hosts the task-conversion dialog for embedded blocks.
export default function PlannerPageView({
  pageId, projectId, projectCliTool, existingTags, onTitleChange,
  onConvertToTodo, onConvertToSchedule, onConvertToSession,
}: PlannerPageViewProps) {
  const { t } = useI18n();
  const [page, setPage] = useState<PlannerPage | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [convert, setConvert] = useState<{ item: PlannerItem; mode: ConvertMode; onDone?: () => void } | null>(null);

  const pendingRef = useRef<{ title: string; content: string | null }>({ title: '', content: null });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    plannerApi.getPlannerPage(pageId).then((p) => {
      if (cancelled) return;
      setPage(p);
      pendingRef.current = { title: p.title, content: p.content ?? null };
    });
    return () => { cancelled = true; };
  }, [pageId]);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const { title, content } = pendingRef.current;
    setSaveState('saving');
    return plannerApi.updatePlannerPage(pageId, { title, content: content ?? undefined })
      .then(() => setSaveState('saved'));
  }, [pageId]);

  useEffect(() => () => { if (timerRef.current) flush(); }, [flush]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState('saving');
    timerRef.current = setTimeout(() => { flush(); }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  const handleTitleChange = (title: string) => {
    pendingRef.current.title = title;
    setPage((p) => (p ? { ...p, title } : p));
    onTitleChange(pageId, title);
    scheduleSave();
  };

  const handleContentChange = (content: string) => {
    pendingRef.current.content = content;
    scheduleSave();
  };

  const openConvert = useCallback((item: PlannerItem, mode: ConvertMode, onDone?: () => void) => {
    setConvert({ item, mode, onDone });
  }, []);

  if (!page) return null;

  return (
    <PlannerPageProvider value={{ projectId, pageId, projectCliTool, existingTags, openConvert }}>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 px-6 pt-5 pb-2">
          <input
            value={page.title}
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
          <PlannerPageEditor initialContent={page.content ?? null} onChange={handleContentChange} />
        </div>
      </div>

      {convert && (
        <PlannerConvertDialog
          item={convert.item}
          mode={convert.mode}
          projectCliTool={projectCliTool}
          onConvert={async (data) => {
            const { item, mode, onDone } = convert;
            if (mode === 'todo') await onConvertToTodo(item.id, data);
            else if (mode === 'session') await onConvertToSession(item.id, data);
            else await onConvertToSchedule(item.id, data);
            onDone?.();
            setConvert(null);
          }}
          onClose={() => setConvert(null)}
        />
      )}
    </PlannerPageProvider>
  );
}
