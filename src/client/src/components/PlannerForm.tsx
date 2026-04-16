import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { PlannerItem } from '../types';
import { useI18n } from '../i18n';

interface PlannerFormProps {
  existingTags: string[];
  editItem?: PlannerItem | null;
  onSave: (data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number; status?: string }) => Promise<void>;
  onCancel: () => void;
}

export default function PlannerForm({ existingTags, editItem, onSave, onCancel }: PlannerFormProps) {
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

  const filteredSuggestions = existingTags.filter(
    (t) => !tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(false);
    tagInputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

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
            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/10 text-cyan-600">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-cyan-800"><X size={10} /></button>
            </span>
          ))}
          <div className="relative flex-1 min-w-[120px]">
            <input
              ref={tagInputRef}
              className="bg-transparent text-sm outline-none w-full"
              style={{ color: 'var(--color-text-primary)' }}
              placeholder={tags.length === 0 ? t('plannerForm.tagsPlaceholder') : ''}
              value={tagInput}
              onChange={(e) => { setTagInput(e.target.value); setShowTagSuggestions(true); }}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) { e.preventDefault(); addTag(tagInput.replace(',', '')); }
                if (e.key === 'Backspace' && !tagInput && tags.length > 0) { removeTag(tags[tags.length - 1]); }
              }}
              onFocus={() => setShowTagSuggestions(true)}
              onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
            />
            {showTagSuggestions && tagInput && filteredSuggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-48 rounded-lg shadow-elevated z-10 py-1" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                {filteredSuggestions.slice(0, 5).map((s) => (
                  <button key={s} className="w-full text-left px-3 py-1.5 text-xs hover:bg-warm-100 transition-colors" style={{ color: 'var(--color-text-primary)' }} onMouseDown={() => addTag(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Due date + Priority (+ Status if editing) */}
      <div className={`grid gap-3 mb-4 ${editItem ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div>
          <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerForm.dueDate')}</label>
          <input
            type="date"
            className="input-field text-xs w-full"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
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
