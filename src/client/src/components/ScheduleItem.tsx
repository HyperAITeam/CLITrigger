import { useState } from 'react';
import { ChevronRight, Clock, Play, Pause, Check, Pencil, Trash2, GitMerge } from 'lucide-react';
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
  onMergeRun?: (todoId: string) => Promise<void>;
  onCleanupRun?: (todoId: string) => Promise<void>;
}

export default function ScheduleItem({ schedule, onToggle, onDelete, onEdit, onTrigger, onMergeRun, onCleanupRun }: ScheduleItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const { t } = useI18n();

  const reloadRuns = async () => {
    try {
      const data = await schedulesApi.getScheduleRuns(schedule.id);
      setRuns(data);
    } catch { /* ignore */ }
  };

  const handleMergeRun = async (run: ScheduleRun) => {
    if (!run.todo_id || !onMergeRun) return;
    setActionRunId(run.id);
    try {
      await onMergeRun(run.todo_id);
      await reloadRuns();
    } finally {
      setActionRunId(null);
    }
  };

  const handleCleanupRun = async (run: ScheduleRun) => {
    if (!run.todo_id || !onCleanupRun) return;
    setActionRunId(run.id);
    try {
      await onCleanupRun(run.todo_id);
      await reloadRuns();
    } finally {
      setActionRunId(null);
    }
  };

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
          <ChevronRight
            size={14}
            className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
        </button>

        {/* Title */}
        <span className="flex-1 text-sm text-warm-800 font-medium truncate">{schedule.title}</span>

        {/* Schedule type & timing badge */}
        {isOnce ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-blue-500/10 text-blue-600 flex-shrink-0">
            <Clock size={12} />
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
            <Play size={14} />
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
              <Pause size={14} />
            ) : (
              <Check size={14} />
            )}
          </button>

          {/* Edit */}
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 text-warm-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
            title={t('schedule.edit')}
          >
            <Pencil size={14} />
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(schedule.id)}
            className="p-1.5 text-warm-400 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
            title={t('schedule.delete')}
          >
            <Trash2 size={14} />
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
                {runs.map((run) => {
                  const canMerge = run.todo_id && run.todo_status === 'completed' && !!run.todo_branch_name;
                  const canCleanup = run.todo_id && run.todo_status !== 'running' && run.todo_status !== 'pending' && (run.todo_worktree_path || run.todo_branch_name);
                  const isActing = actionRunId === run.id;

                  return (
                    <div key={run.id} className="flex items-center gap-3 text-xs py-1.5 px-3 rounded-lg bg-theme-hover">
                      <span className={`font-medium ${runStatusColor[run.status] || 'text-warm-500'}`}>
                        {runStatusLabel[run.status] || run.status}
                      </span>
                      {run.skipped_reason && (
                        <span className="text-warm-400">({run.skipped_reason})</span>
                      )}
                      {/* Git action buttons */}
                      <div className="flex items-center gap-0.5 ml-auto">
                        {canMerge && onMergeRun && (
                          <button
                            onClick={() => handleMergeRun(run)}
                            disabled={isActing}
                            className="p-1 text-status-merged/60 hover:text-status-merged hover:bg-status-merged/10 rounded transition-colors disabled:opacity-30"
                            title={t('todo.merge')}
                          >
                            <GitMerge size={12} />
                          </button>
                        )}
                        {canCleanup && onCleanupRun && (
                          <button
                            onClick={() => handleCleanupRun(run)}
                            disabled={isActing}
                            className="p-1 text-status-warning/60 hover:text-status-warning hover:bg-status-warning/10 rounded transition-colors disabled:opacity-30"
                            title={t('todo.cleanup')}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <span className="text-warm-400 font-mono flex-shrink-0">
                        {new Date(run.started_at).toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
