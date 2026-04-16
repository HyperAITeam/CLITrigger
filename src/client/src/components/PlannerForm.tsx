import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Image as ImageIcon } from 'lucide-react';
import type { PlannerItem, PlannerTag, ImageMeta } from '../types';
import { useI18n } from '../i18n';
import { getTagStyle } from './plannerTagColors';
import { uploadPlannerImages, deletePlannerImage, getPlannerImageUrl } from '../api/planner';

interface PendingImage {
  id: string;
  name: string;
  data: string;
  preview: string;
}

let imageCounter = 0;

interface PlannerFormProps {
  existingTags: PlannerTag[];
  editItem?: PlannerItem | null;
  onSave: (data: { title: string; description?: string; tags?: string; due_date?: string; priority?: number; status?: string }) => Promise<PlannerItem | void>;
  onCancel: () => void;
  onUpdateTag?: (name: string, data: { color?: string }) => Promise<void>;
}

export default function PlannerForm({ existingTags, editItem, onSave, onCancel, onUpdateTag }: PlannerFormProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(0);
  const [status, setStatus] = useState('pending');
  const [saving, setSaving] = useState(false);
  const [showTagDrop, setShowTagDrop] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [existingImages, setExistingImages] = useState<ImageMeta[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localTagColors, setLocalTagColors] = useState<Map<string, string>>(new Map());
  const tagColorMap = new Map([...existingTags.map(t => [t.name, t.color] as [string, string]), ...localTagColors]);

  const CYCLE_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'red', 'yellow', 'brown'];

  useEffect(() => {
    if (editItem) {
      setTitle(editItem.title);
      setDescription(editItem.description ?? '');
      setTags(editItem.tags ? JSON.parse(editItem.tags) : []);
      setDueDate(editItem.due_date ?? '');
      setPriority(editItem.priority);
      setStatus(editItem.status);
      try { setExistingImages(editItem.images ? JSON.parse(editItem.images) : []); } catch { setExistingImages([]); }
    }
    titleRef.current?.focus();
  }, [editItem]);

  const suggestions = existingTags.filter(
    (t) => !tags.includes(t.name) && (!tagInput || t.name.toLowerCase().includes(tagInput.toLowerCase()))
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => {
        const next = [...prev, trimmed];
        if (!tagColorMap.has(trimmed)) {
          const nextColor = CYCLE_COLORS[(tagColorMap.size) % CYCLE_COLORS.length];
          setLocalTagColors((m) => new Map([...m, [trimmed, nextColor]]));
        }
        return next;
      });
    }
    setTagInput('');
    setShowTagDrop(true);
    tagInputRef.current?.focus();
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const addImagesFromFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        const id = `pending-${++imageCounter}`;
        setPendingImages(prev => [...prev, { id, name: file.name, data, preview: data }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    addImagesFromFiles(files);
  }, [addImagesFromFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files) addImagesFromFiles(e.dataTransfer.files);
  }, [addImagesFromFiles]);

  const removePendingImage = (id: string) => setPendingImages(prev => prev.filter(img => img.id !== id));

  const removeExistingImage = (imageId: string) => {
    if (editItem) deletePlannerImage(editItem.id, imageId);
    setExistingImages(prev => prev.filter(img => img.id !== imageId));
  };

  const totalImages = existingImages.length + pendingImages.length;

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const result = await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? JSON.stringify(tags) : undefined,
        due_date: dueDate || undefined,
        priority,
        ...(editItem ? { status } : {}),
      });
      if (onUpdateTag && localTagColors.size > 0) {
        await Promise.all([...localTagColors.entries()].map(([name, color]) => onUpdateTag(name, { color })));
      }
      // Upload pending images
      if (pendingImages.length > 0) {
        const targetId = editItem?.id ?? (result as PlannerItem | undefined)?.id;
        if (targetId) {
          await uploadPlannerImages(targetId, pendingImages.map(img => ({ name: img.name, data: img.data })));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-5 animate-slide-up" style={{ borderColor: 'var(--color-accent)', borderWidth: '1px' }}>
      <input
        ref={titleRef}
        className="input-field text-sm w-full mb-3"
        placeholder={t('plannerForm.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
      />

      <textarea
        className="input-field text-sm w-full mb-3"
        rows={3}
        placeholder={t('plannerForm.descPlaceholder')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      />
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors"
        >
          <ImageIcon size={14} />
          {t('plannerForm.addImage')}
        </button>
        <span className="text-[10px] text-warm-300">{t('plannerForm.pasteHint')}</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addImagesFromFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {totalImages > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider">{t('plannerForm.images')}</h4>
            <span className="text-[10px] text-warm-400">({totalImages})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {existingImages.map(img => (
              <div key={img.id} className="relative group">
                <img
                  src={editItem ? getPlannerImageUrl(editItem.id, img.id) : ''}
                  alt={img.originalName}
                  className="h-20 w-20 object-cover rounded-lg border border-warm-200"
                />
                <button
                  type="button"
                  onClick={() => removeExistingImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} strokeWidth={3} />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 rounded-b-lg px-1 py-0.5">
                  <span className="text-[8px] text-white truncate block">{img.originalName}</span>
                </div>
              </div>
            ))}
            {pendingImages.map(img => (
              <div key={img.id} className="relative group">
                <img src={img.preview} alt={img.name} className="h-20 w-20 object-cover rounded-lg border border-blue-300/30" />
                <button
                  type="button"
                  onClick={() => removePendingImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} strokeWidth={3} />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 rounded-b-lg px-1 py-0.5">
                  <span className="text-[8px] text-white truncate block">{img.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags — simple select/add only */}
      <div className="mb-4">
        <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerForm.tags')}</label>
        <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl" style={{ backgroundColor: 'var(--color-bg-input)', border: '1px solid var(--color-border-strong)' }}>
          {tags.map((tag) => (
            <span key={tag} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${getTagStyle(tagColorMap.get(tag) || 'default')}`}>
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
              onChange={(e) => { setTagInput(e.target.value); setShowTagDrop(true); }}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) { e.preventDefault(); addTag(tagInput.replace(',', '')); }
                if (e.key === 'Backspace' && !tagInput && tags.length > 0) removeTag(tags[tags.length - 1]);
              }}
              onFocus={() => setShowTagDrop(true)}
              onBlur={() => setTimeout(() => setShowTagDrop(false), 150)}
            />
            {showTagDrop && (suggestions.length > 0 || tagInput.trim()) && (
              <div className="absolute top-full left-0 mt-1 w-52 rounded-lg shadow-elevated z-10 py-1.5 max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                {suggestions.slice(0, 10).map((tagObj) => (
                  <button key={tagObj.name} className="flex items-center w-full px-2.5 py-1 hover:bg-warm-100/50 transition-colors text-left" onMouseDown={() => addTag(tagObj.name)}>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${getTagStyle(tagObj.color)}`}>{tagObj.name}</span>
                  </button>
                ))}
                {tagInput.trim() && !existingTags.some(t => t.name === tagInput.trim()) && (
                  <button className="flex items-center w-full px-2.5 py-1 hover:bg-warm-100/50 transition-colors text-left" onMouseDown={() => addTag(tagInput)}>
                    <span className="text-xs text-warm-500">+ "{tagInput.trim()}"</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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

      <div className="flex justify-end gap-3">
        <button className="btn-ghost text-xs" onClick={onCancel}>{t('plannerForm.cancel')}</button>
        <button className="btn-primary text-xs py-2" onClick={handleSubmit} disabled={!title.trim() || saving}>
          {t('plannerForm.save')}
        </button>
      </div>
    </div>
  );
}
