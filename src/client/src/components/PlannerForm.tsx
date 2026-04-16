import { useState, useEffect, useRef } from 'react';
import { X, MoreHorizontal, Trash2 } from 'lucide-react';
import type { PlannerItem, PlannerTag } from '../types';
import { useI18n } from '../i18n';
import { getTagStyle, TAG_COLOR_MAP, TAG_COLOR_KEYS } from './plannerTagColors';

interface PlannerFormProps {
  existingTags: PlannerTag[];
  editItem?: PlannerItem | null;
  onSave: (data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number; status?: string }) => Promise<void>;
  onCancel: () => void;
  onUpdateTag?: (name: string, data: { color?: string; new_name?: string }) => Promise<void>;
  onDeleteTag?: (name: string) => Promise<void>;
}

export default function PlannerForm({ existingTags, editItem, onSave, onCancel, onUpdateTag, onDeleteTag }: PlannerFormProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(0);
  const [status, setStatus] = useState('pending');
  const [saving, setSaving] = useState(false);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editItem) {
      setTitle(editItem.title);
      setDescription(editItem.description ?? '');
      setTags(editItem.tags ? JSON.parse(editItem.tags) : []);
      setDueDate(editItem.due_date ?? '');
      setPriority(editItem.priority);
      setStatus(editItem.status);
    }
    titleRef.current?.focus();
  }, [editItem]);

  const tagColorMap = new Map(existingTags.map(t => [t.name, t.color]));
  const getColor = (name: string) => tagColorMap.get(name) || 'default';

  const filteredSuggestions = existingTags.filter(
    (t) => !tags.includes(t.name) && (!tagInput || t.name.toLowerCase().includes(tagInput.toLowerCase()))
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(true);
    tagInputRef.current?.focus();
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? JSON.stringify(tags) : undefined,
        due_date: dueDate || undefined,
        priority,
        ...(editItem ? { status } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTagColorChange = async (tagName: string, color: string) => {
    if (onUpdateTag) await onUpdateTag(tagName, { color });
  };

  const handleTagRename = async (oldName: string) => {
    const newName = editTagName.trim();
    if (!newName || newName === oldName) { setEditingTag(null); return; }
    if (onUpdateTag) await onUpdateTag(oldName, { new_name: newName, color: getColor(oldName) });
    // Update local tags array too
    setTags(prev => prev.map(t => t === oldName ? newName : t));
    setEditingTag(null);
  };

  const handleTagDelete = async (tagName: string) => {
    if (!confirm(t('plannerTag.deleteConfirm'))) return;
    if (onDeleteTag) await onDeleteTag(tagName);
    setTags(prev => prev.filter(t => t !== tagName));
    setEditingTag(null);
  };

  return (
    <div className="card p-5 animate-slide-up" style={{ borderColor: 'var(--color-accent)', borderWidth: '1px' }}>
      {/* Title */}
      <input
        ref={titleRef}
        className="input-field text-sm w-full mb-3"
        placeholder={t('plannerForm.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
      />

      {/* Description */}
      <textarea
        className="input-field text-sm w-full mb-4"
        rows={3}
        placeholder={t('plannerForm.descPlaceholder')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {/* Tags */}
      <div className="mb-4">
        <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerForm.tags')}</label>
        <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border-strong)' }}>
          {tags.map((tag) => (
            <span key={tag} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${getTagStyle(getColor(tag))}`}>
              {tag}
              <button onClick={() => removeTag(tag)} className="opacity-60 hover:opacity-100"><X size={10} /></button>
            </span>
          ))}
          <div className="relative flex-1 min-w-[120px]">
            <input
              ref={tagInputRef}
              className="bg-transparent text-sm outline-none w-full"
              style={{ color: 'var(--color-text-primary)' }}
              placeholder={tags.length === 0 ? t('plannerForm.tagsPlaceholder') : ''}
              value={tagInput}
              onChange={(e) => { setTagInput(e.target.value); setShowTagSuggestions(true); setEditingTag(null); }}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) { e.preventDefault(); addTag(tagInput.replace(',', '')); }
                if (e.key === 'Backspace' && !tagInput && tags.length > 0) { removeTag(tags[tags.length - 1]); }
              }}
              onFocus={() => { setShowTagSuggestions(true); setEditingTag(null); }}
              onBlur={() => setTimeout(() => { if (!editingTag) setShowTagSuggestions(false); }, 200)}
            />

            {/* Tag dropdown */}
            {showTagSuggestions && (filteredSuggestions.length > 0 || tagInput.trim()) && (
              <div className="absolute top-full left-0 mt-1 w-64 rounded-lg shadow-elevated z-10 py-2 max-h-64 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                <div className="text-[10px] text-warm-400 mb-1 px-3">{t('plannerTag.selectOrCreate')}</div>

                {filteredSuggestions.slice(0, 12).map((tagObj) => (
                  <div key={tagObj.name} className="group flex items-center gap-1 px-2 py-0.5">
                    {editingTag === tagObj.name ? (
                      /* Tag edit panel */
                      <div className="w-full p-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-tertiary)' }} onMouseDown={(e) => e.preventDefault()}>
                        <input
                          className="input-field text-xs w-full mb-2 py-1"
                          value={editTagName}
                          onChange={(e) => setEditTagName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTagRename(tagObj.name); }}
                          autoFocus
                        />
                        <button
                          onClick={() => handleTagDelete(tagObj.name)}
                          className="flex items-center gap-2 w-full px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors mb-2"
                        >
                          <Trash2 size={12} /> {t('plannerTag.delete')}
                        </button>
                        <div className="text-[10px] text-warm-400 mb-1">{t('plannerTag.color')}</div>
                        <div className="grid grid-cols-5 gap-1">
                          {TAG_COLOR_KEYS.map((colorKey) => (
                            <button
                              key={colorKey}
                              onClick={() => handleTagColorChange(tagObj.name, colorKey)}
                              className={`w-full aspect-square rounded-md flex items-center justify-center transition-all ${tagObj.color === colorKey ? 'ring-2 ring-offset-1 ring-blue-400' : 'hover:scale-110'}`}
                              style={{ ringOffset: 'var(--color-bg-card)' } as React.CSSProperties}
                              title={t(`plannerTag.color.${colorKey}`)}
                            >
                              <div className={`w-5 h-5 rounded ${TAG_COLOR_MAP[colorKey].swatch}`} />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* Normal tag row */
                      <>
                        <button
                          className="flex-1 flex items-center gap-2 px-1 py-1 rounded-md hover:bg-warm-100/50 transition-colors text-left"
                          onMouseDown={() => addTag(tagObj.name)}
                        >
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${getTagStyle(tagObj.color)}`}>{tagObj.name}</span>
                        </button>
                        <button
                          className="p-1 text-warm-400 hover:text-warm-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => { e.preventDefault(); setEditingTag(tagObj.name); setEditTagName(tagObj.name); }}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {/* Create new tag option */}
                {tagInput.trim() && !existingTags.some(t => t.name === tagInput.trim()) && (
                  <button
                    className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-warm-100/50 transition-colors text-left"
                    onMouseDown={() => addTag(tagInput)}
                  >
                    <span className="text-xs text-warm-500">+ "{tagInput.trim()}"</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Due date + Priority (+ Status if editing) */}
      <div className={`grid gap-3 mb-4 ${editItem ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div>
          <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerForm.dueDate')}</label>
          <input type="date" className="input-field text-xs w-full" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerForm.priority')}</label>
          <select className="input-field text-xs w-full" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={0}>{t('plannerForm.priorityLow')}</option>
            <option value={1}>{t('plannerForm.priorityNormal')}</option>
            <option value={2}>{t('plannerForm.priorityHigh')}</option>
            <option value={3}>{t('plannerForm.priorityCritical')}</option>
          </select>
        </div>
        {editItem && (
          <div>
            <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerForm.status')}</label>
            <select className="input-field text-xs w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">{t('plannerStatus.pending')}</option>
              <option value="in_progress">{t('plannerStatus.in_progress')}</option>
              <option value="done">{t('plannerStatus.done')}</option>
            </select>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3">
        <button className="btn-ghost text-xs" onClick={onCancel}>{t('plannerForm.cancel')}</button>
        <button className="btn-primary text-xs py-2" onClick={handleSubmit} disabled={!title.trim() || saving}>
          {t('plannerForm.save')}
        </button>
      </div>
    </div>
  );
}
