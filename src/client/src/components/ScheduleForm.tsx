import { useState } from 'react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool } from '../cli-tools';
import { useModels } from '../hooks/useModels';
import CronBuilder from './CronBuilder';

type ScheduleType = 'recurring' | 'once';

interface ScheduleFormProps {
  onSave: (data: {
    title: string;
    description: string;
    cronExpression: string;
    cliTool?: string;
    cliModel?: string;
    skipIfRunning?: boolean;
    scheduleType: ScheduleType;
    runAt?: string;
  }) => void;
  onCancel: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialCronExpression?: string;
  initialCliTool?: string;
  initialCliModel?: string;
  initialSkipIfRunning?: boolean;
  initialScheduleType?: ScheduleType;
  initialRunAt?: string;
  projectCliTool?: string;
  projectCliModel?: string;
}

function getDefaultRunAt(): string {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  now.setMinutes(0, 0, 0);
  // Format as local datetime for input[type=datetime-local]
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function toLocalDatetimeValue(isoStr: string): string {
  const date = new Date(isoStr);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}`;
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
  initialScheduleType = 'recurring',
  initialRunAt,
  projectCliTool = 'claude',
  projectCliModel = '',
}: ScheduleFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [cronExpression, setCronExpression] = useState(initialCronExpression);
  const [cliTool, setCliTool] = useState<CliTool>((initialCliTool as CliTool) || (projectCliTool as CliTool) || 'claude');
  const [cliModel, setCliModel] = useState(initialCliModel ?? projectCliModel ?? '');
  const [skipIfRunning, setSkipIfRunning] = useState(initialSkipIfRunning);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initialScheduleType);
  const [runAt, setRunAt] = useState(initialRunAt ? toLocalDatetimeValue(initialRunAt) : getDefaultRunAt());
  const { t } = useI18n();
  const { getToolConfig } = useModels();

  const toolConfig = getToolConfig(cliTool);

  const handleCliToolChange = (newTool: CliTool) => {
    setCliTool(newTool);
    setCliModel('');
  };

  const isOnce = scheduleType === 'once';
  const canSubmit = title.trim() && (isOnce ? !!runAt : !!cronExpression.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSave({
      title: title.trim(),
      description: description.trim(),
      cronExpression: isOnce ? '' : cronExpression.trim(),
      cliTool,
      cliModel: cliModel || undefined,
      skipIfRunning,
      scheduleType,
      runAt: isOnce ? new Date(runAt).toISOString() : undefined,
    });
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

      {/* Schedule Type Toggle */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-warm-500 mb-1.5">
          {t('schedule.type')}
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setScheduleType('recurring')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              scheduleType === 'recurring'
                ? 'bg-amber-500 text-white'
                : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            {t('schedule.recurring')}
          </button>
          <button
            type="button"
            onClick={() => setScheduleType('once')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              scheduleType === 'once'
                ? 'bg-amber-500 text-white'
                : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            {t('schedule.once')}
          </button>
        </div>
      </div>

      {/* Cron Expression (recurring) or DateTime picker (once) */}
      {isOnce ? (
        <div className="mb-3">
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('schedule.runAtLabel')}
          </label>
          <input
            type="datetime-local"
            value={runAt}
            onChange={(e) => setRunAt(e.target.value)}
            className="input-field text-sm font-mono"
            min={new Date().toISOString().slice(0, 16)}
          />
        </div>
      ) : (
        <div className="mb-3">
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('schedule.cronExpression')}
          </label>
          <CronBuilder value={cronExpression} onChange={setCronExpression} />
        </div>
      )}

      {/* CLI Tool & Model */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1.5">
            {t('scheduleForm.cliTool')}
          </label>
          <select
            value={cliTool}
            onChange={(e) => handleCliToolChange(e.target.value as CliTool)}
            className="input-field text-sm !py-2"
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
            className="input-field text-sm !py-2"
          >
            {toolConfig.models.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Skip if Running (only for recurring) */}
      {!isOnce && (
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
      )}

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
          disabled={!canSubmit}
          className="btn-primary text-sm"
        >
          {t('scheduleForm.save')}
        </button>
      </div>
    </form>
  );
}
