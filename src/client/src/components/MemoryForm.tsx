import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { MemoryNode } from '../types';
import { useI18n } from '../i18n';
import { parseMemoryTags } from '../api/memory';
import WikilinkAutocomplete from './WikilinkAutocomplete';

interface MemoryFormProps {
  editNode?: MemoryNode | null;
  /** Other memory nodes in this project (used for `[[wikilink]]` autocomplete). */
  allNodes?: MemoryNode[];
  onSave: (data: { title: string; body: string; tags: string[]; pinned: boolean }) => Promise<void>;
  onCancel: () => void;
}

export default function MemoryForm({ editNode, allNodes = [], onSave, onCancel }: MemoryFormProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Filter out the node being edited so it can't link to itself
  const linkableNodes = editNode ? allNodes.filter(n => n.id !== editNode.id) : allNodes;

  useEffect(() => {
    if (editNode) {
      setTitle(editNode.title);
      setBody(editNode.body || '');
      setTags(parseMemoryTags(editNode.tags));
      setPinned(editNode.pinned === 1);
    } else {
      setTitle('');
      setBody('');
      setTags([]);
      setPinned(false);
    }
    titleRef.current?.focus();
  }, [editNode]);

  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags(prev => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => setTags(prev => prev.filter(t => t !== tag));

  const handleSubmit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), body, tags, pinned });
    } finally {
      setSaving(false);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (tagInput) addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(prev => prev.slice(0, -1));
    }
  };

  return (
    <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-warm-800">
          {editNode ? t('memory.form.editTitle') : t('memory.form.newTitle')}
        </h3>
        <button onClick={onCancel} className="p-1 hover:bg-warm-200 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-warm-600 mb-1">{t('memory.form.title')}</label>
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('memory.form.titlePlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-0 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400"
          />
        </div>

        <div>
          <label className="block text-xs text-warm-600 mb-1">{t('memory.form.body')}</label>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t('memory.form.bodyPlaceholder')}
            rows={8}
            className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-0 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-warm-400 resize-y"
          />
          <WikilinkAutocomplete
            textareaRef={bodyRef}
            value={body}
            nodes={linkableNodes}
            onChange={setBody}
          />
          <div className="mt-1 text-[11px] text-warm-500">
            {t('memory.form.linkHint')}
          </div>
        </div>

        <div>
          <label className="block text-xs text-warm-600 mb-1">{t('memory.form.tags')}</label>
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-warm-200 bg-warm-0 min-h-[38px]">
            {tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warm-200 text-xs text-warm-800">
                {tag}
                <button onClick={() => removeTag(tag)} className="hover:text-warm-900">
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => tagInput && addTag(tagInput)}
              placeholder={tags.length === 0 ? t('memory.form.tagsPlaceholder') : ''}
              className="flex-1 min-w-[80px] bg-transparent text-sm focus:outline-none"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-warm-700">
          <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
          {t('memory.form.pinned')}
        </label>
      </div>

      <div className="flex gap-2 mt-5">
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || saving}
          className="px-4 py-2 rounded-lg bg-warm-700 text-warm-50 text-sm font-medium hover:bg-warm-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? t('memory.saving') : t('memory.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100"
        >
          {t('memory.cancel')}
        </button>
      </div>
    </div>
  );
}
