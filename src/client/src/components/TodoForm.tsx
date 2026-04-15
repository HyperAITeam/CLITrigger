import { useState, useRef, useCallback } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool } from '../cli-tools';
import { useModels } from '../hooks/useModels';
import type { ImageMeta, Todo } from '../types';
import { getTodoImageUrl } from '../api/todos';

export interface PendingImage {
  id: string;
  name: string;
  data: string; // base64 data URL
  preview: string;
}

interface TodoFormProps {
  onSave: (title: string, description: string, cliTool?: string, cliModel?: string, newImages?: PendingImage[], dependsOn?: string, maxTurns?: number) => void;
  onCancel: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialCliTool?: string;
  initialCliModel?: string;
  initialDependsOn?: string;
  initialMaxTurns?: number;
  projectCliTool?: string;
  projectCliModel?: string;
  existingImages?: ImageMeta[];
  todoId?: string;
  onDeleteImage?: (imageId: string) => void;
  availableTodos?: Todo[];
}

let imageCounter = 0;

export default function TodoForm({
  onSave,
  onCancel,
  initialTitle = '',
  initialDescription = '',
  initialCliTool,
  initialCliModel,
  initialDependsOn,
  initialMaxTurns,
  projectCliTool = 'claude',
  projectCliModel = '',
  existingImages = [],
  todoId,
  onDeleteImage,
  availableTodos = [],
}: TodoFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [cliTool, setCliTool] = useState<CliTool>((initialCliTool as CliTool) || (projectCliTool as CliTool) || 'claude');
  const [cliModel, setCliModel] = useState(initialCliModel ?? projectCliModel ?? '');
  const [dependsOn, setDependsOn] = useState(initialDependsOn ?? '');
  const [maxTurns, setMaxTurns] = useState(initialMaxTurns?.toString() ?? '');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [existingImgs, setExistingImgs] = useState<ImageMeta[]>(existingImages);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const { getToolConfig } = useModels();

  const toolConfig = getToolConfig(cliTool);

  const handleCliToolChange = (newTool: CliTool) => {
    setCliTool(newTool);
    setCliModel('');
  };

  const addImagesFromFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        const id = `pending-${++imageCounter}`;
        setPendingImages(prev => [...prev, {
          id,
          name: file.name,
          data,
          preview: data,
        }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    e.preventDefault();
    const files: File[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    addImagesFromFiles(files);
  }, [addImagesFromFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files) {
      addImagesFromFiles(e.dataTransfer.files);
    }
  }, [addImagesFromFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const removePendingImage = (id: string) => {
    setPendingImages(prev => prev.filter(img => img.id !== id));
  };

  const removeExistingImage = (imageId: string) => {
    if (onDeleteImage) {
      onDeleteImage(imageId);
    }
    setExistingImgs(prev => prev.filter(img => img.id !== imageId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const parsedMaxTurns = maxTurns ? parseInt(maxTurns, 10) : undefined;
    onSave(title.trim(), description.trim(), cliTool, cliModel || undefined, pendingImages.length > 0 ? pendingImages : undefined, dependsOn || undefined, parsedMaxTurns || undefined);
  };

  const totalImages = existingImgs.length + pendingImages.length;

  return (
    <form onSubmit={handleSubmit} className="card p-5 border-accent/30">
      <div className="mb-3">
        <input
          type="text"
          placeholder={t('todoForm.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input-field"
          autoFocus
        />
      </div>
      <div className="mb-4">
        <textarea
          ref={textareaRef}
          placeholder={t('todoForm.descPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          rows={3}
          className="input-field resize-none"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors"
          >
            <ImageIcon size={14} />
            {t('todoForm.addImage')}
          </button>
          <span className="text-[10px] text-warm-300">
            {t('todoForm.pasteHint')}
          </span>
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
      </div>

      {/* Image previews */}
      {totalImages > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider">
              {t('todoForm.images')}
            </h4>
            <span className="text-[10px] text-warm-400">({totalImages})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Existing images (already uploaded) */}
            {existingImgs.map(img => (
              <div key={img.id} className="relative group">
                <img
                  src={todoId ? getTodoImageUrl(todoId, img.id) : ''}
                  alt={img.originalName}
                  className="h-20 w-20 object-cover rounded-lg border border-warm-200"
                />
                <button
                  type="button"
                  onClick={() => removeExistingImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-status-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} strokeWidth={3} />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 rounded-b-lg px-1 py-0.5">
                  <span className="text-[8px] text-white truncate block">{img.originalName}</span>
                </div>
              </div>
            ))}
            {/* Pending images (not yet uploaded) */}
            {pendingImages.map(img => (
              <div key={img.id} className="relative group">
                <img
                  src={img.preview}
                  alt={img.name}
                  className="h-20 w-20 object-cover rounded-lg border border-accent/30"
                />
                <button
                  type="button"
                  onClick={() => removePendingImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-status-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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

      {/* CLI Tool & Model Selection */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('todoForm.cliTool')}
          </label>
          <select
            value={cliTool}
            onChange={(e) => handleCliToolChange(e.target.value as CliTool)}
            className="input-field text-sm"
          >
            {CLI_TOOLS.map((tool) => (
              <option key={tool.value} value={tool.value}>{tool.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('todoForm.aiModel')}
          </label>
          <select
            value={cliModel}
            onChange={(e) => setCliModel(e.target.value)}
            className="input-field text-sm"
          >
            {toolConfig.models.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Max Turns */}
      {cliTool === 'claude' && (
        <div className="mb-4">
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('todoForm.maxTurns')}
          </label>
          <input
            type="number"
            min="1"
            max="500"
            placeholder={t('todoForm.maxTurnsPlaceholder')}
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            className="input-field text-sm w-32"
          />
          <p className="text-[10px] text-warm-400 mt-1">
            {t('todoForm.maxTurnsHint')}
          </p>
        </div>
      )}

      {/* Dependency Selection */}
      {availableTodos.length > 0 && (
        <div className="mb-4">
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('todoForm.dependsOn')}
          </label>
          <select
            value={dependsOn}
            onChange={(e) => setDependsOn(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">{t('todoForm.noDependency')}</option>
            {availableTodos.map((todo) => (
              <option key={todo.id} value={todo.id}>
                {todo.title} ({t(`status.${todo.status}` as 'status.pending')})
              </option>
            ))}
          </select>
          {dependsOn && (
            <p className="text-[10px] text-warm-400 mt-1">
              {t('todoForm.dependsOnHint')}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost text-sm"
        >
          {t('todoForm.cancel')}
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="btn-primary text-sm"
        >
          {t('todoForm.save')}
        </button>
      </div>
    </form>
  );
}
