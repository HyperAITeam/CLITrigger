import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, getToolConfig, type CliTool } from '../cli-tools';
import MemoryInjectControl from './MemoryInjectControl';
import type { MemoryInjectMode } from '../types';

export interface SessionFormInitial {
  title: string;
  description: string;
  cliTool: string;
  cliModel: string;
  useWorktree: boolean;
  memoryInjectMode: MemoryInjectMode;
  memoryNodeIds: string[];
  memoryRawFilePaths?: string[];
}

interface SessionFormProps {
  projectId: string;
  /** Present → edit mode, prefills the form. Absent → create mode (defaults). */
  initial?: SessionFormInitial;
  onSave: (
    title: string,
    description: string,
    cliTool?: string,
    cliModel?: string,
    useWorktree?: boolean,
    memoryInjectMode?: MemoryInjectMode,
    memoryNodeIds?: string[],
    memoryRawFilePaths?: string[],
  ) => void;
  onCancel: () => void;
  projectCliTool?: string;
  projectCliModel?: string;
  isGitRepo?: boolean;
  /** Default for `useWorktree` in create mode; ignored when `initial` is set. */
  projectUseWorktree?: boolean;
}

export default function SessionForm({ projectId, initial, onSave, onCancel, projectCliTool, projectCliModel, isGitRepo, projectUseWorktree }: SessionFormProps) {
  const { t } = useI18n();
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cliTool, setCliTool] = useState(initial?.cliTool ?? (projectCliTool || ''));
  const [cliModel, setCliModel] = useState(initial?.cliModel ?? (projectCliModel || ''));
  const [useWorktree, setUseWorktree] = useState(initial?.useWorktree ?? !!projectUseWorktree);
  const [memoryInjectMode, setMemoryInjectMode] = useState<MemoryInjectMode>(initial?.memoryInjectMode ?? 'none');
  const [memoryNodeIds, setMemoryNodeIds] = useState<string[]>(initial?.memoryNodeIds ?? []);
  const [memoryRawFilePaths, setMemoryRawFilePaths] = useState<string[]>(initial?.memoryRawFilePaths ?? []);

  const interactiveTools = CLI_TOOLS.filter((tool) => tool.supportsInteractive);
  const selectedTool = (cliTool || projectCliTool || 'claude') as CliTool;
  const toolConfig = getToolConfig(selectedTool);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(
      title.trim(),
      description.trim(),
      cliTool || undefined,
      cliModel || undefined,
      useWorktree,
      memoryInjectMode,
      memoryNodeIds,
      memoryRawFilePaths,
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="card p-4 space-y-3 animate-scale-in"
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('session.title')}
        className="input w-full text-sm"
        autoFocus
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('session.description')}
        className="input w-full text-sm min-h-[60px] resize-y"
        rows={2}
      />
      <div className="flex gap-2">
        <select
          value={cliTool}
          onChange={(e) => { setCliTool(e.target.value); setCliModel(''); }}
          className="input text-xs flex-1"
        >
          <option value="">{t('session.cliTool')} (Default)</option>
          {interactiveTools.map((tool) => (
            <option key={tool.value} value={tool.value}>{tool.label}</option>
          ))}
        </select>
        <select
          value={cliModel}
          onChange={(e) => setCliModel(e.target.value)}
          className="input text-xs flex-1"
        >
          <option value="">{t('session.model')} (Default)</option>
          {toolConfig.models.filter((m) => m.value).map((model) => (
            <option key={model.value} value={model.value}>{model.label}</option>
          ))}
        </select>
      </div>
      {isGitRepo && (
        <label className="flex items-center gap-2 text-xs text-warm-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useWorktree}
            onChange={(e) => setUseWorktree(e.target.checked)}
            className="rounded border-warm-300"
          />
          <GitBranch size={14} />
          {t('session.worktree')}
        </label>
      )}
      <MemoryInjectControl
        projectId={projectId}
        mode={memoryInjectMode}
        selectedIds={memoryNodeIds}
        onChange={(m, ids) => { setMemoryInjectMode(m); setMemoryNodeIds(ids); }}
        rawFilePaths={memoryRawFilePaths}
        onChangeRawFiles={setMemoryRawFilePaths}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5 px-3">
          {t('form.cancel')}
        </button>
        <button type="submit" disabled={!title.trim()} className="btn-primary text-xs py-1.5 px-3">
          {isEdit ? t('session.save') : t('session.create')}
        </button>
      </div>
    </form>
  );
}
