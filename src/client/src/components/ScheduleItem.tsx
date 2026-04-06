import { useState } from 'react';
import type { Schedule, ScheduleRun } from '../types';
import * as schedulesApi from '../api/schedules';
import ScheduleForm from './ScheduleForm';
import { useI18n } from '../i18n';

interface ScheduleItemProps {
  schedule: Schedule;
  onToggle: (id: string, activate: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string, updates: { title?: string; description?: string; cron_expression?: string; cli_tool?: string; cli_model?: string; skip_if_running?: boolean; schedule_type?: string; run_at?: string }) => Promise<void>;
  onTrigger: (id: string) => Promise<void>;
}

export default function ScheduleItem({ schedule, onToggle, onDelete, onEdit, onTrigger }: ScheduleItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const { t } = useI18n();

  const isOnce = schedule.schedule_type === 'once';

  const loadRuns = async () => {
    if (!runsLoaded) {
      try {
        const data = await schedulesApi.getScheduleRuns(schedule.id);
        setRuns(data);
        setRunsLoaded(true);
      } catch { /* ignore */ }
    }
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadRuns();
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await onTrigger(schedule.id);
      // Reload runs after trigger
      const data = await schedulesApi.getScheduleRuns(schedule.id);
      setRuns(data);
      setRunsLoaded(true);
    } finally {
      setTriggering(false);
    }
  };

  if (editing) {
    return (
      <ScheduleForm
        initialTitle={schedule.title}
        initialDescription={schedule.description ?? ''}
        initialCronExpression={isOnce ? '' : schedule.cron_expression}
        initialCliTool={schedule.cli_tool ?? undefined}
        initialCliModel={schedule.cli_model ?? undefined}
        initialSkipIfRunning={!!schedule.skip_if_running}
        initialScheduleType={schedule.schedule_type}
        initialRunAt={schedule.run_at ?? undefined}
        onSave={async (data) => {
          await onEdit(schedule.id, {
            title: data.title,
            description: data.description,
            cron_expression: data.cronExpression || undefined,
            cli_tool: data.cliTool,
            cli_model: data.cliModel,
            skip_if_running: data.skipIfRunning,
            schedule_type: data.scheduleType,
            run_at: data.runAt,
          });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const borderColor = schedule.is_active ? 'border-l-amber-500' : 'border-l-warm-300';

  const runStatusColor: Record<string, string> = {
    triggered: 'text-status-running',
    skipped: 'text-status-warning',
    completed: 'text-status-success',
    failed: 'text-status-error',
  };

  const runStatusLabel: Record<string, string> = {
    triggered: t('schedule.runTriggered'),
    skipped: t('schedule.runSkipped'),
    completed: t('schedule.runCompleted'),
    failed: t('schedule.runFailed'),
  };

  // Format run_at for display
  const formatRunAt = (runAtStr: string | null) => {
    if (!runAtStr) return '';
    return new Date(runAtStr).toLocaleString();
  };

  return (
    <div className={`card border-l-4 ${borderColor} overflow-hidden`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-warm-50 transition-colors"
        onClick={handleExpand}
      >
        {/* Expand arrow */}
        <button className="text-warm-400 hover:text-amber-500 flex-shrink-0 transition-colors">
          <svg
            className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>

        {/* Title */}
        <span className="flex-1 text-sm text-warm-800 font-medium truncate">{schedule.title}</span>

        {/* Schedule type & timing badge */}
        {isOnce ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-blue-500/10 text-blue-600 flex-shrink-0">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatRunAt(schedule.run_at)}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-500/10 text-amber-600 flex-shrink-0">
            {schedule.cron_expression}
          </span>
        )}

        {/* Once / Recurring badge */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          isOnce
            ? 'bg-blue-500/10 text-blue-600'
            : 'bg-amber-500/10 text-amber-600'
        }`}>
          {isOnce ? t('schedule.once') : t('schedule.recurring')}
        </span>

        {/* Active/Paused badge */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          schedule.is_active
            ? 'bg-status-success/10 text-status-success'
            : 'bg-warm-200 text-warm-500'
        }`}>
          {schedule.is_active ? t('schedule.active') : t('schedule.paused')}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 ml-2" onClick={(e) => e.stopPropagation()}>
          {/* Trigger now */}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="p-1.5 text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-30"
            title={t('schedule.trigger')}
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          {/* Toggle active/pause */}
          <button
            onClick={() => onToggle(schedule.id, !schedule.is_active)}
            className={`p-1.5 rounded-lg transition-colors ${
              schedule.is_active
                ? 'text-status-warning/60 hover:text-status-warning hover:bg-status-warning/10'
                : 'text-status-success/60 hover:text-status-success hover:bg-status-success/10'
            }`}
            title={schedule.is_active ? t('schedule.pause') : t('schedule.activate')}
          >
            {schedule.is_active ? (
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* Edit */}
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 text-warm-400 hover:text-accent-gold hover:bg-accent-gold/10 rounded-lg transition-colors"
            title={t('schedule.edit')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(schedule.id)}
            className="p-1.5 text-warm-400 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
            title={t('schedule.delete')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-warm-200 px-5 py-5 space-y-4 animate-fade-in bg-warm-50/50">
          {/* Description */}
          {schedule.description && (
            <div>
              <p className="text-sm text-warm-600 whitespace-pre-wrap leading-relaxed">
                {schedule.description}
              </p>
            </div>
          )}

          {/* Info badges */}
          <div className="flex flex-wrap gap-2 text-xs">
            {isOnce ? (
              <span className="badge bg-blue-500/10 text-blue-600 font-mono">
                {t('schedule.runAtLabel')}: {formatRunAt(schedule.run_at)}
              </span>
            ) : (
              <span className="badge bg-amber-500/10 text-amber-600 font-mono">
                {schedule.cron_expression}
              </span>
            )}
            {!isOnce && schedule.skip_if_running ? (
              <span className="badge bg-status-info/10 text-status-info">
                {t('schedule.skipIfRunning')}
              </span>
            ) : null}
            <span className="badge bg-warm-200 text-warm-600">
              {t('schedule.lastRun')}: {schedule.last_run_at
                ? new Date(schedule.last_run_at).toLocaleString()
                : t('schedule.never')}
            </span>
          </div>

          {/* Run History */}
          <div>
            <h4 className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">
              {t('schedule.runs')}
            </h4>
            {runs.length === 0 ? (
              <p className="text-xs text-warm-400 italic">{t('schedule.noRuns')}</p>
            ) : (
              <div className="max-h-48 overflow-auto space-y-1">
                {runs.map((run) => (
                  <div key={run.id} className="flex items-center gap-3 text-xs py-1.5 px-3 rounded-lg bg-theme-card/50">
                    <span className={`font-medium ${runStatusColor[run.status] || 'text-warm-500'}`}>
                      {runStatusLabel[run.status] || run.status}
                    </span>
                    {run.skipped_reason && (
                      <span className="text-warm-400">({run.skipped_reason})</span>
                    )}
                    <span className="text-warm-400 ml-auto font-mono">
                      {new Date(run.started_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
