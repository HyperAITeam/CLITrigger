import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlannerPage } from '../types';
import * as plannerApi from '../api/planner';
import { useI18n } from '../i18n';
import PlannerPageEditor from './PlannerPageEditor';

const SAVE_DEBOUNCE_MS = 800;

interface PlannerPageViewProps {
  pageId: string;
  // Report title edits up so the sidebar list stays in sync.
  onTitleChange: (pageId: string, title: string) => void;
}

// Self-contained page editor: loads its own content, autosaves (debounced),
// and flushes on unmount. Mount with key={pageId} so switching pages remounts.
export default function PlannerPageView({ pageId, onTitleChange }: PlannerPageViewProps) {
  const { t } = useI18n();
  const [page, setPage] = useState<PlannerPage | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

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

  // Flush pending edits on unmount (page switch / leaving workspace).
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

  if (!page) return null;

  return (
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
  );
}
