import { useState } from 'react';
import { Plus, CalendarClock } from 'lucide-react';
import type { Schedule } from '../types';
import ScheduleItem from './ScheduleItem';
import ScheduleForm from './ScheduleForm';
import EmptyState from './EmptyState';
import CursorContextMenu, { ctxMenuItemClass, isNativeContextMenuTarget } from './CursorContextMenu';
import { useI18n } from '../i18n';

interface ScheduleListProps {
  schedules: Schedule[];
  projectCliTool?: string;
  onAddSchedule: (data: {
    title: string;
    description: string;
    cronExpression: string;
    cliTool?: string;
    skipIfRunning?: boolean;
    scheduleType: 'recurring' | 'once';
    runAt?: string;
  }) => Promise<void>;
  onToggleSchedule: (id: string, activate: boolean) => Promise<void>;
  onDeleteSchedule: (id: string) => Promise<void>;
  onEditSchedule: (id: string, updates: { title?: string; description?: string; cron_expression?: string; cli_tool?: string; skip_if_running?: boolean; schedule_type?: string; run_at?: string }) => Promise<void>;
  onTriggerSchedule: (id: string) => Promise<void>;
  onMergeRun?: (todoId: string) => Promise<void>;
  onCleanupRun?: (todoId: string) => Promise<void>;
}

export default function ScheduleList({
  schedules,
  projectCliTool,
  onAddSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onEditSchedule,
  onTriggerSchedule,
  onMergeRun,
  onCleanupRun,
}: ScheduleListProps) {
  const [showForm, setShowForm] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const { t } = useI18n();

  return (
    <div
      // min-h so blank space below a short list still catches the
      // right-click → "new routine" menu.
      className="min-h-[50vh]"
      onContextMenu={(e) => {
        if (isNativeContextMenuTarget(e)) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
          {t('schedules.title')}
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary btn-sm"
          >
            <Plus size={14} />
            {t('schedules.add')}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-5 animate-slide-up">
          <ScheduleForm
            projectCliTool={projectCliTool}
            onSave={async (data) => {
              await onAddSchedule(data);
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="space-y-3">
        {schedules.length === 0 ? (
          <div className="card">
            <EmptyState icon={CalendarClock} title={t('schedules.empty')} description={t('schedules.emptyHint')} />
          </div>
        ) : (
          schedules.map((schedule, index) => (
            <div key={schedule.id} className="animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
              <ScheduleItem
                schedule={schedule}
                onToggle={onToggleSchedule}
                onDelete={onDeleteSchedule}
                onEdit={onEditSchedule}
                onTrigger={onTriggerSchedule}
                onMergeRun={onMergeRun}
                onCleanupRun={onCleanupRun}
              />
            </div>
          ))
        )}
      </div>

      {ctxMenu && (
        <CursorContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          <button type="button" className={ctxMenuItemClass} onClick={() => setShowForm(true)}>
            <Plus size={14} />
            {t('schedules.add')}
          </button>
        </CursorContextMenu>
      )}
    </div>
  );
}
