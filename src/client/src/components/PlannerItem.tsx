import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, Pencil, ArrowRight, Clock, Trash2 } from 'lucide-react';
import type { PlannerItem as PlannerItemType } from '../types';
import { useI18n } from '../i18n';

// Hash-based tag color assignment
const TAG_COLORS = [
  'bg-cyan-500/10 text-cyan-600',
  'bg-purple-500/10 text-purple-600',
  'bg-amber-500/10 text-amber-700',
  'bg-emerald-500/10 text-emerald-600',
  'bg-rose-500/10 text-rose-600',
  'bg-blue-500/10 text-blue-600',
  'bg-orange-500/10 text-orange-600',
];

function getTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-500',
  in_progress: 'bg-blue-500/10 text-blue-600',
  done: 'bg-emerald-500/10 text-emerald-600',
  moved: 'bg-purple-500/10 text-purple-600',
};

const PRIORITY_LABELS: Record<number, { label: string; style: string }> = {
  0: { label: '—', style: 'text-warm-300' },
  1: { label: '●', style: 'text-warm-500' },
  2: { label: '●●', style: 'text-amber-500' },
  3: { label: '●●●', style: 'text-red-500' },
};

interface PlannerItemProps {
  item: PlannerItemType;
  onEdit: () => void;
  onDelete: () => void;
  onConvertToTodo: () => void;
  onConvertToSchedule: () => void;
}

export default function PlannerItem({ item, onEdit, onDelete, onConvertToTodo, onConvertToSchedule }: PlannerItemProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const tags: string[] = item.tags ? (() => { try { return JSON.parse(item.tags!); } catch { return []; } })() : [];
  const isMoved = item.status === 'moved';
  const isOverdue = item.due_date && new Date(item.due_date) < new Date() && !isMoved && item.status !== 'done';

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
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors hover:bg-warm-50 ${isMoved ? 'opacity-50' : ''}`}
      style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
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

      {/* Tags — w-[160px] to match header */}
      <div className="hidden sm:flex items-center gap-1 w-[160px] flex-shrink-0 overflow-hidden">
        {tags.map((tag) => (
          <span key={tag} className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${getTagColor(tag)}`}>
            {tag}
          </span>
        ))}
      </div>

      {/* Priority — w-12 to match header */}
      <div className="hidden sm:block w-12 text-center flex-shrink-0">
        <span className={`text-xs font-medium ${PRIORITY_LABELS[item.priority]?.style ?? 'text-warm-300'}`}>
          {PRIORITY_LABELS[item.priority]?.label ?? '—'}
        </span>
      </div>

      {/* Due date — w-20 to match header */}
      <div className="hidden md:block w-20 text-right flex-shrink-0">
        {item.due_date ? (
          <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-warm-500'}`}>
            {new Date(item.due_date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
          </span>
        ) : (
          <span className="text-xs text-warm-300">{t('planner.noDueDate')}</span>
        )}
      </div>

      {/* Status badge — fixed w-16 to match header */}
      <div className="w-16 flex-shrink-0">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[item.status] || STATUS_STYLES.pending}`}>
          {t(`plannerStatus.${item.status}`)}
        </span>
      </div>

      {/* Actions menu — fixed w-8 to match header */}
      <div className="w-8 flex-shrink-0">
        <button
          ref={btnRef}
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-warm-100/50 rounded-lg transition-colors"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen && createPortal(
          <div
            ref={dropRef}
            className={`fixed z-[9999] min-w-[160px] rounded-xl py-1 shadow-elevated${positioned ? ' animate-scale-in' : ''}`}
            style={{
              top: pos.top,
              left: pos.left,
              opacity: positioned ? 1 : 0,
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
            }}
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
  );
}
