import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, ArrowRight, Clock, Trash2, ChevronRight, X } from 'lucide-react';
import type { PlannerItem as PlannerItemType } from '../types';
import { useI18n } from '../i18n';
import { getTagStyle, TAG_COLOR_MAP, TAG_COLOR_KEYS } from './plannerTagColors';

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
  tagColors: Map<string, string>;
  existingTags: string[];
  onSave: (id: string, data: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
  onConvertToTodo: () => void;
  onConvertToSchedule: () => void;
  onUpdateTag?: (name: string, data: { color?: string }) => Promise<void>;
}

export default function PlannerItem({ item, tagColors, existingTags, onSave, onDelete, onConvertToTodo, onConvertToSchedule, onUpdateTag }: PlannerItemProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Inline edit state
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDesc, setEditDesc] = useState(item.description ?? '');
  const [editPriority, setEditPriority] = useState(item.priority);
  const [editDueDate, setEditDueDate] = useState(item.due_date ?? '');
  const [editStatus, setEditStatus] = useState(item.status);
  const [editTags, setEditTags] = useState<string[]>(() => {
    try { return item.tags ? JSON.parse(item.tags) : []; } catch { return []; }
  });
  const [tagInput, setTagInput] = useState('');
  const [showTagDrop, setShowTagDrop] = useState(false);
  const [colorPickTag, setColorPickTag] = useState<string | null>(null);
  const tagRef = useRef<HTMLInputElement>(null);

  // Sync when item prop changes
  useEffect(() => {
    setEditTitle(item.title);
    setEditDesc(item.description ?? '');
    setEditPriority(item.priority);
    setEditDueDate(item.due_date ?? '');
    setEditStatus(item.status);
    try { setEditTags(item.tags ? JSON.parse(item.tags) : []); } catch { setEditTags([]); }
  }, [item]);

  const tags = editTags;
  const isMoved = item.status === 'moved';
  const isOverdue = item.due_date && new Date(item.due_date) < new Date() && !isMoved && item.status !== 'done';

  // Auto-save helper
  const save = useCallback((patch: Record<string, unknown>) => {
    onSave(item.id, patch);
  }, [item.id, onSave]);

  const saveTitle = () => {
    const v = editTitle.trim();
    if (v && v !== item.title) save({ title: v });
    else setEditTitle(item.title);
  };

  const saveDesc = () => {
    const v = editDesc.trim();
    if (v !== (item.description ?? '')) save({ description: v || undefined });
  };

  const savePriority = (v: number) => {
    setEditPriority(v);
    if (v !== item.priority) save({ priority: v });
  };

  const saveDueDate = (v: string) => {
    setEditDueDate(v);
    if (v !== (item.due_date ?? '')) save({ due_date: v || undefined });
  };

  const saveStatus = (v: string) => {
    setEditStatus(v);
    if (v !== item.status) save({ status: v });
  };

  const saveTags = (next: string[]) => {
    setEditTags(next);
    const prev = (() => { try { return item.tags ? JSON.parse(item.tags) : []; } catch { return []; } })() as string[];
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      save({ tags: next.length > 0 ? JSON.stringify(next) : undefined });
    }
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !editTags.includes(trimmed)) {
      saveTags([...editTags, trimmed]);
      if (!tagColors.has(trimmed) && onUpdateTag) {
        const cycleColors = ['blue', 'green', 'orange', 'purple', 'pink', 'red', 'yellow', 'brown'];
        const nextColor = cycleColors[tagColors.size % cycleColors.length];
        onUpdateTag(trimmed, { color: nextColor });
      }
    }
    setTagInput('');
    tagRef.current?.focus();
  };

  const removeTag = (tag: string) => saveTags(editTags.filter(t => t !== tag));

  const tagSuggestions = existingTags.filter(
    t => !editTags.includes(t) && (!tagInput || t.toLowerCase().includes(tagInput.toLowerCase()))
  );

  // Portal menu positioning
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
            <span key={tag} className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${getTagStyle(tagColors.get(tag) || 'default')}`}>{tag}</span>
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

        {/* Status */}
        <div className="w-16 flex-shrink-0">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[item.status] || STATUS_STYLES.pending}`}>
            {t(`plannerStatus.${item.status}`)}
          </span>
        </div>

        {/* More menu */}
        <div className="w-8 flex-shrink-0">
          <button ref={btnRef} onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-warm-100/50 rounded-lg transition-colors">
            <MoreVertical size={14} />
          </button>
          {menuOpen && createPortal(
            <div ref={dropRef} className={`fixed z-[9999] min-w-[160px] rounded-xl py-1 shadow-elevated${positioned ? ' animate-scale-in' : ''}`}
              style={{ top: pos.top, left: pos.left, opacity: positioned ? 1 : 0, backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              onClick={() => setMenuOpen(false)}
            >
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

      {/* Expanded inline-edit panel */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 ml-8 animate-fade-in">
          <div className="rounded-lg px-4 py-3 space-y-3" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
            {/* Title edit */}
            <input
              className="bg-transparent text-sm font-medium w-full outline-none border-b border-transparent focus:border-warm-300 pb-0.5 transition-colors"
              style={{ color: 'var(--color-text-primary)' }}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveTitle(); (e.target as HTMLInputElement).blur(); } }}
            />

            {/* Description edit */}
            <textarea
              className="bg-transparent text-sm w-full outline-none border border-transparent focus:border-warm-300 rounded-md p-1 transition-colors resize-none"
              style={{ color: 'var(--color-text-secondary)' }}
              rows={3}
              placeholder={t('plannerForm.descPlaceholder')}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              onBlur={saveDesc}
            />

            {/* Tags inline edit */}
            <div>
              <label className="text-[10px] text-warm-400 mb-1 block">{t('plannerForm.tags')}</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {editTags.map((tag) => (
                  <div key={tag} className="relative">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:ring-1 hover:ring-warm-400 transition-all ${getTagStyle(tagColors.get(tag) || 'default')}`}
                      onClick={() => setColorPickTag(colorPickTag === tag ? null : tag)}
                    >
                      {tag}
                      <button onClick={(e) => { e.stopPropagation(); removeTag(tag); }} className="opacity-60 hover:opacity-100"><X size={9} /></button>
                    </span>
                    {colorPickTag === tag && (
                      <div className="absolute top-full left-0 mt-1 p-2 rounded-lg shadow-elevated z-20 w-[180px]" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                        <div className="text-[10px] text-warm-400 mb-1.5">{t('plannerTag.color')}</div>
                        <div className="grid grid-cols-5 gap-1.5">
                          {TAG_COLOR_KEYS.map((colorKey) => (
                            <button
                              key={colorKey}
                              onClick={async () => {
                                if (onUpdateTag) await onUpdateTag(tag, { color: colorKey });
                                setColorPickTag(null);
                              }}
                              className={`aspect-square rounded-md flex items-center justify-center transition-all ${tagColors.get(tag) === colorKey ? 'ring-2 ring-blue-400 ring-offset-1' : 'hover:scale-110'}`}
                              title={t(`plannerTag.color.${colorKey}`)}
                            >
                              <div className={`w-5 h-5 rounded ${TAG_COLOR_MAP[colorKey].swatch}`} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div className="relative">
                  <input
                    ref={tagRef}
                    className="bg-transparent text-xs outline-none w-24"
                    style={{ color: 'var(--color-text-primary)' }}
                    placeholder="+"
                    value={tagInput}
                    onChange={(e) => { setTagInput(e.target.value); setShowTagDrop(true); }}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) { e.preventDefault(); addTag(tagInput.replace(',', '')); }
                      if (e.key === 'Backspace' && !tagInput && editTags.length > 0) removeTag(editTags[editTags.length - 1]);
                    }}
                    onFocus={() => setShowTagDrop(true)}
                    onBlur={() => setTimeout(() => setShowTagDrop(false), 150)}
                  />
                  {showTagDrop && tagSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 w-40 rounded-lg shadow-elevated z-10 py-1 max-h-32 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                      {tagSuggestions.slice(0, 8).map((s) => (
                        <button key={s} className="flex items-center w-full px-2 py-1 hover:bg-warm-100/50 transition-colors text-left" onMouseDown={() => addTag(s)}>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${getTagStyle(tagColors.get(s) || 'default')}`}>{s}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Priority / Due date / Status row */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-warm-400 mb-1 block">{t('plannerForm.priority')}</label>
                <select className="input-field text-xs w-full py-1" value={editPriority} onChange={(e) => savePriority(Number(e.target.value))}>
                  <option value={0}>{t('plannerForm.priorityLow')}</option>
                  <option value={1}>{t('plannerForm.priorityNormal')}</option>
                  <option value={2}>{t('plannerForm.priorityHigh')}</option>
                  <option value={3}>{t('plannerForm.priorityCritical')}</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-warm-400 mb-1 block">{t('plannerForm.dueDate')}</label>
                <input type="date" className="input-field text-xs w-full py-1" value={editDueDate} onChange={(e) => saveDueDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-warm-400 mb-1 block">{t('plannerForm.status')}</label>
                <select className="input-field text-xs w-full py-1" value={editStatus} onChange={(e) => saveStatus(e.target.value)}>
                  <option value="pending">{t('plannerStatus.pending')}</option>
                  <option value="in_progress">{t('plannerStatus.in_progress')}</option>
                  <option value="done">{t('plannerStatus.done')}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
