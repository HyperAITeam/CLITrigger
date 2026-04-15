import { useState } from 'react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, getToolConfig, type CliTool } from '../cli-tools';

interface SessionFormProps {
  onSave: (title: string, description: string, cliTool?: string, cliModel?: string) => void;
  onCancel: () => void;
  projectCliTool?: string;
  projectCliModel?: string;
}

export default function SessionForm({ onSave, onCancel, projectCliTool, projectCliModel }: SessionFormProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cliTool, setCliTool] = useState(projectCliTool || '');
  const [cliModel, setCliModel] = useState(projectCliModel || '');

  const interactiveTools = CLI_TOOLS.filter((tool) => tool.supportsInteractive);
  const selectedTool = (cliTool || projectCliTool || 'claude') as CliTool;
  const toolConfig = getToolConfig(selectedTool);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim(), description.trim(), cliTool || undefined, cliModel || undefined);
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
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5 px-3">
          {t('form.cancel')}
        </button>
        <button type="submit" disabled={!title.trim()} className="btn-primary text-xs py-1.5 px-3">
          {t('session.create')}
        </button>
      </div>
    </form>
  );
}
