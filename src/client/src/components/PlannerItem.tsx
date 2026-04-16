import { useState, useRef, useEffect } from 'react';
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
  const menuRef = useRef<HTMLDivElement>(null);

  const tags: string[] = item.tags ? (() => { try { return JSON.parse(item.tags!); } catch { return []; } })() : [];
  const isMoved = item.status === 'moved';
  const isOverdue = item.due_date && new Date(item.due_date) < new Date() && !isMoved && item.status !== 'done';

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

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

      {/* Tags */}
      <div className="hidden sm:flex items-center gap-1 flex-shrink-0 max-w-[200px] overflow-hidden">
        {tags.map((tag) => (
          <span key={tag} className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${getTagColor(tag)}`}>
            {tag}
          </span>
        ))}
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
      <div className="flex-shrink-0">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[item.status] || STATUS_STYLES.pending}`}>
          {t(`plannerStatus.${item.status}`)}
        </span>
      </div>

      {/* Actions menu */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-warm-100/50 rounded-lg transition-colors"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-elevated z-20 py-1" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
            <button onClick={() => { onEdit(); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
              <Pencil size={12} /> {t('planner.edit')}
            </button>
            {!isMoved && (
              <>
                <button onClick={() => { onConvertToTodo(); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                  <ArrowRight size={12} /> {t('planner.convertToTask')}
                </button>
                <button onClick={() => { onConvertToSchedule(); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-warm-100 rounded-md transition-colors text-left" style={{ color: 'var(--color-text-primary)' }}>
                  <Clock size={12} /> {t('planner.convertToSchedule')}
                </button>
              </>
            )}
            <button onClick={() => { if (confirm(t('planner.deleteConfirm'))) { onDelete(); } setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-md transition-colors text-left">
              <Trash2 size={12} /> {t('planner.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
