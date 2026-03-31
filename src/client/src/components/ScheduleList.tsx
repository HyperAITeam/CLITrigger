import { useState } from 'react';
import type { Schedule } from '../types';
import ScheduleItem from './ScheduleItem';
import ScheduleForm from './ScheduleForm';
import { useI18n } from '../i18n';

interface ScheduleListProps {
  schedules: Schedule[];
  projectCliTool?: string;
  projectCliModel?: string;
  onAddSchedule: (data: {
    title: string;
    description: string;
    cronExpression: string;
    cliTool?: string;
    cliModel?: string;
    skipIfRunning?: boolean;
    scheduleType: 'recurring' | 'once';
    runAt?: string;
  }) => Promise<void>;
  onToggleSchedule: (id: string, activate: boolean) => Promise<void>;
  onDeleteSchedule: (id: string) => Promise<void>;
  onEditSchedule: (id: string, updates: { title?: string; description?: string; cron_expression?: string; cli_tool?: string; cli_model?: string; skip_if_running?: boolean; schedule_type?: string; run_at?: string }) => Promise<void>;
  onTriggerSchedule: (id: string) => Promise<void>;
}

export default function ScheduleList({
  schedules,
  projectCliTool,
  projectCliModel,
  onAddSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onEditSchedule,
  onTriggerSchedule,
}: ScheduleListProps) {
  const [showForm, setShowForm] = useState(false);
  const { t } = useI18n();

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
          {t('schedules.title')}
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary text-xs py-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('schedules.add')}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-5 animate-slide-up">
          <ScheduleForm
            projectCliTool={projectCliTool}
            projectCliModel={projectCliModel}
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
          <div className="card p-10 text-center">
            <p className="text-warm-600 font-medium">{t('schedules.empty')}</p>
            <p className="text-warm-400 text-sm mt-1">{t('schedules.emptyHint')}</p>
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
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
