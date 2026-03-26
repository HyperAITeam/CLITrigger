import { useState } from 'react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, getToolConfig, type CliTool } from '../cli-tools';

interface TodoFormProps {
  onSave: (title: string, description: string, cliTool?: string, cliModel?: string) => void;
  onCancel: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialCliTool?: string;
  initialCliModel?: string;
  projectCliTool?: string;
  projectCliModel?: string;
}

export default function TodoForm({
  onSave,
  onCancel,
  initialTitle = '',
  initialDescription = '',
  initialCliTool,
  initialCliModel,
  projectCliTool = 'claude',
  projectCliModel = '',
}: TodoFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [cliTool, setCliTool] = useState<CliTool>((initialCliTool as CliTool) || (projectCliTool as CliTool) || 'claude');
  const [cliModel, setCliModel] = useState(initialCliModel ?? projectCliModel ?? '');
  const { t } = useI18n();

  const toolConfig = getToolConfig(cliTool);

  const handleCliToolChange = (newTool: CliTool) => {
    setCliTool(newTool);
    setCliModel('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim(), description.trim(), cliTool, cliModel || undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5 border-accent-gold/30">
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
          placeholder={t('todoForm.descPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="input-field resize-none"
        />
      </div>

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
