import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, Pencil, ArrowRight, Clock, Trash2, ChevronRight } from 'lucide-react';
import type { PlannerItem as PlannerItemType } from '../types';
import { useI18n } from '../i18n';
import { getTagStyle } from './plannerTagColors';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-500',
  in_progress: 'bg-blue-500/10 text-blue-600',
  done: 'bg-emerald-500/10 text-emerald-600',
  moved: 'bg-purple-500/10 text-purple-600',
};

const PRIORITY_LABELS: Record<number, { label: string; style: string; text: string }> = {
  0: { label: '—', style: 'text-warm-300', text: '' },
  1: { label: '●', style: 'text-warm-500', text: 'Normal' },
  2: { label: '●●', style: 'text-amber-500', text: 'High' },
  3: { label: '●●●', style: 'text-red-500', text: 'Critical' },
};

interface PlannerItemProps {
  item: PlannerItemType;
  tagColors: Map<string, string>;
  onEdit: () => void;
  onDelete: () => void;
  onConvertToTodo: () => void;
  onConvertToSchedule: () => void;
}

export default function PlannerItem({ item, tagColors, onEdit, onDelete, onConvertToTodo, onConvertToSchedule }: PlannerItemProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const tags: string[] = item.tags ? (() => { try { return JSON.parse(item.tags!); } catch { return []; } })() : [];
  const isMoved = item.status === 'moved';
  const isOverdue = item.due_date && new Date(item.due_date) < new Date() && !isMoved && item.status !== 'done';
  const hasDetail = !!(item.description || item.due_date || item.priority > 0);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + 4;
    const drop = dropRef.current;
    if (drop) {
      const dw = drop.offsetWidth;
      const dh = drop.offsetHeight;
      let left = r.right - dw;
      if (left < 8) left = 8;
      if (left + dw > vw - 8) left = vw - 8 - dw;
      if (top + dh > vh - 8) top = r.top - dh - 4;
      setPos({ top, left });
      setPositioned(true);
    } else {
      setPos({ top, left: Math.max(8, r.right - 180) });
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) { setPositioned(false); return; }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || dropRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [menuOpen, updatePos]);

  return (
    <div className={`${isMoved ? 'opacity-50' : ''}`} style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
      {/* Row */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors hover:bg-warm-50 cursor-pointer"
        onDoubleClick={() => setExpanded(!expanded)}
      >
        {/* Expand arrow */}
        <ChevronRight
          size={14}
          className={`text-warm-400 transition-transform duration-200 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        />

        {/* Title */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: 'var(--color-text-primary)' }}>
            {item.title}
          </span>
          {isMoved && item.converted_type && (
            <span className="text-[10px] text-purple-500">
              → {item.converted_type === 'todo' ? t('planner.movedToTodo') : t('planner.movedToSchedule')}
            </span>
          )}
        </div>

        {/* Tags */}
        <div className="hidden sm:flex items-center gap-1 w-[160px] flex-shrink-0 overflow-hidden">
          {tags.map((tag) => (
            <span key={tag} className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${getTagStyle(tagColors.get(tag) || 'default')}`}>
              {tag}
            </span>
          ))}
        </div>

        {/* Priority */}
        <div className="hidden sm:block w-12 text-center flex-shrink-0">
          <span className={`text-xs font-medium ${PRIORITY_LABELS[item.priority]?.style ?? 'text-warm-300'}`}>
            {PRIORITY_LABELS[item.priority]?.label ?? '—'}
          </span>
        </div>

        {/* Due date */}
        <div className="hidden md:block w-20 text-right flex-shrink-0">
          {item.due_date ? (
            <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-warm-500'}`}>
              {new Date(item.due_date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
            </span>
          ) : (
            <span className="text-xs text-warm-300">{t('planner.noDueDate')}</span>
          )}
        </div>

        {/* Status badge */}
        <div className="w-16 flex-shrink-0">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[item.status] || STATUS_STYLES.pending}`}>
            {t(`plannerStatus.${item.status}`)}
          </span>
        </div>

        {/* Actions menu */}
        <div className="w-8 flex-shrink-0">
          <button
            ref={btnRef}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-warm-100/50 rounded-lg transition-colors"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && createPortal(
            <div
              ref={dropRef}
              className={`fixed z-[9999] min-w-[160px] rounded-xl py-1 shadow-elevated${positioned ? ' animate-scale-in' : ''}`}
              style={{ top: pos.top, left: pos.left, opacity: positioned ? 1 : 0, backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              onClick={() => setMenuOpen(false)}
            >
              <button onClick={onEdit} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                <Pencil size={12} /> {t('planner.edit')}
              </button>
              {!isMoved && (
                <>
                  <button onClick={onConvertToTodo} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                    <ArrowRight size={12} /> {t('planner.convertToTask')}
                  </button>
                  <button onClick={onConvertToSchedule} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                    <Clock size={12} /> {t('planner.convertToSchedule')}
                  </button>
                </>
              )}
              <button onClick={() => { if (confirm(t('planner.deleteConfirm'))) onDelete(); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-md transition-colors text-left">
                <Trash2 size={12} /> {t('planner.delete')}
              </button>
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 ml-8 animate-fade-in">
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
            {/* Description */}
            {item.description ? (
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>{item.description}</p>
            ) : (
              <p className="text-xs text-warm-400 italic">{t('plannerForm.descPlaceholder')}</p>
            )}

            {/* Meta badges row */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {/* Priority (mobile visible here) */}
              {item.priority > 0 && (
                <span className={`text-xs font-medium ${PRIORITY_LABELS[item.priority]?.style}`}>
                  {t('plannerForm.priority')}: {PRIORITY_LABELS[item.priority]?.text}
                </span>
              )}
              {/* Due date (mobile visible here) */}
              {item.due_date && (
                <span className={`text-xs ${isOverdue ? 'text-red-500' : 'text-warm-500'}`}>
                  {t('plannerForm.dueDate')}: {new Date(item.due_date).toLocaleDateString()}
                </span>
              )}
              {/* Tags on mobile */}
              <div className="sm:hidden flex items-center gap-1">
                {tags.map((tag) => (
                  <span key={tag} className={`px-2 py-0.5 rounded text-[10px] font-medium ${getTagStyle(tagColors.get(tag) || 'default')}`}>{tag}</span>
                ))}
              </div>
              {/* Created at */}
              <span className="text-[10px] text-warm-400 font-mono">
                {new Date(item.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
