import { useState } from 'react';
import { useI18n } from '../i18n';
import type { PlannerItem } from '../types';
import Modal from './Modal';

type ConvertMode = 'todo' | 'schedule' | 'session';

interface PlannerConvertDialogProps {
  item: PlannerItem;
  mode: ConvertMode;
  projectCliTool?: string;
  onConvert: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export default function PlannerConvertDialog({
  item, mode, projectCliTool, onConvert, onClose,
}: PlannerConvertDialogProps) {
  const { t } = useI18n();
  const [cliTool, setCliTool] = useState(projectCliTool || 'claude');
  const [maxTurns, setMaxTurns] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [scheduleType, setScheduleType] = useState<'once' | 'recurring'>('once');
  const [cronExpression, setCronExpression] = useState('0 0 * * *');
  const [runAt, setRunAt] = useState('');
  const [converting, setConverting] = useState(false);

  const handleConvert = async () => {
    setConverting(true);
    try {
      if (mode === 'todo') {
        await onConvert({
          cli_tool: cliTool,
          max_turns: maxTurns ? Number(maxTurns) : undefined,
        });
      } else if (mode === 'session') {
        await onConvert({
          cli_tool: cliTool,
          use_worktree: useWorktree,
        });
      } else {
        await onConvert({
          cli_tool: cliTool,
          schedule_type: scheduleType,
          cron_expression: scheduleType === 'recurring' ? cronExpression : undefined,
          run_at: scheduleType === 'once' ? runAt : undefined,
        });
      }
    } finally {
      setConverting(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" position="top" animation="slide-up">
      <div className="card p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
          {mode === 'todo' ? t('plannerConvert.toTask') : mode === 'session' ? t('plannerConvert.toTerminal') : t('plannerConvert.toSchedule')}
        </h3>

        <p className="text-xs text-warm-500 mb-4 truncate">"{item.title}"</p>

        {/* CLI Tool */}
        <div className="mb-3">
          <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerConvert.cliTool')}</label>
          <select className="input-field text-xs w-full" value={cliTool} onChange={(e) => setCliTool(e.target.value)}>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="codex">Codex</option>
          </select>
        </div>

        {/* TODO mode: Max turns */}
        {mode === 'todo' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerConvert.maxTurns')}</label>
            <input
              type="number" min="1" className="input-field text-xs w-full"
              placeholder="—" value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)}
            />
          </div>
        )}

        {/* Session mode: worktree toggle */}
        {mode === 'session' && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
            />
            <span className="text-xs font-medium text-warm-500">{t('plannerConvert.useWorktree')}</span>
          </label>
        )}

        {/* Schedule mode */}
        {mode === 'schedule' && (
          <>
            <div className="mb-3">
              <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerConvert.scheduleType')}</label>
              <div className="flex gap-1 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
                <button
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${scheduleType === 'once' ? 'bg-amber-500 text-white' : 'text-warm-500'}`}
                  onClick={() => setScheduleType('once')}
                >{t('plannerConvert.once')}</button>
                <button
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${scheduleType === 'recurring' ? 'bg-amber-500 text-white' : 'text-warm-500'}`}
                  onClick={() => setScheduleType('recurring')}
                >{t('plannerConvert.recurring')}</button>
              </div>
            </div>
            {scheduleType === 'once' ? (
              <div className="mb-4">
                <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerConvert.runAt')}</label>
                <input type="datetime-local" className="input-field text-xs w-full" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
              </div>
            ) : (
              <div className="mb-4">
                <label className="text-xs font-medium text-warm-500 mb-1.5 block">{t('plannerConvert.cronExpression')}</label>
                <input className="input-field text-xs w-full font-mono" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} placeholder="0 0 * * *" />
              </div>
            )}
          </>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-3">
          <button className="btn-ghost text-xs" onClick={onClose}>{t('plannerConvert.cancel')}</button>
          <button
            className="btn-primary btn-sm"
            onClick={handleConvert}
            disabled={converting || (mode === 'schedule' && scheduleType === 'once' && !runAt)}
          >
            {t('plannerConvert.convert')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
