import { useState } from 'react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, getToolConfig, type CliTool } from '../cli-tools';

interface ScheduleFormProps {
  onSave: (title: string, description: string, cronExpression: string, cliTool?: string, cliModel?: string, skipIfRunning?: boolean) => void;
  onCancel: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialCronExpression?: string;
  initialCliTool?: string;
  initialCliModel?: string;
  initialSkipIfRunning?: boolean;
  projectCliTool?: string;
  projectCliModel?: string;
}

export default function ScheduleForm({
  onSave,
  onCancel,
  initialTitle = '',
  initialDescription = '',
  initialCronExpression = '',
  initialCliTool,
  initialCliModel,
  initialSkipIfRunning = true,
  projectCliTool = 'claude',
  projectCliModel = '',
}: ScheduleFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [cronExpression, setCronExpression] = useState(initialCronExpression);
  const [cliTool, setCliTool] = useState<CliTool>((initialCliTool as CliTool) || (projectCliTool as CliTool) || 'claude');
  const [cliModel, setCliModel] = useState(initialCliModel ?? projectCliModel ?? '');
  const [skipIfRunning, setSkipIfRunning] = useState(initialSkipIfRunning);
  const { t } = useI18n();

  const toolConfig = getToolConfig(cliTool);

  const handleCliToolChange = (newTool: CliTool) => {
    setCliTool(newTool);
    setCliModel('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !cronExpression.trim()) return;
    onSave(title.trim(), description.trim(), cronExpression.trim(), cliTool, cliModel || undefined, skipIfRunning);
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5 border-amber-500/30">
      <div className="mb-3">
        <input
          type="text"
          placeholder={t('scheduleForm.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input-field"
          autoFocus
        />
      </div>
      <div className="mb-3">
        <textarea
          placeholder={t('scheduleForm.descPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="input-field resize-none"
        />
      </div>

      {/* Cron Expression */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-warm-500 mb-1.5">
          {t('schedule.cronExpression')}
        </label>
        <input
          type="text"
          placeholder="*/30 * * * *"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          className="input-field font-mono"
        />
        <p className="text-[10px] text-warm-400 mt-1">
          {t('schedule.cronHint')}
        </p>
      </div>

      {/* CLI Tool & Model */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('scheduleForm.cliTool')}
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
            {t('scheduleForm.aiModel')}
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

      {/* Skip if Running */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm text-warm-600 cursor-pointer">
          <input
            type="checkbox"
            checked={skipIfRunning}
            onChange={(e) => setSkipIfRunning(e.target.checked)}
            className="rounded border-warm-300 text-amber-500 focus:ring-amber-500"
          />
          {t('schedule.skipIfRunning')}
        </label>
      </div>

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost text-sm"
        >
          {t('scheduleForm.cancel')}
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !cronExpression.trim()}
          className="btn-primary text-sm"
        >
          {t('scheduleForm.save')}
        </button>
      </div>
    </form>
  );
}
