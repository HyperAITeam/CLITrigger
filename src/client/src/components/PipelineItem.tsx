import type { Pipeline } from '../types';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

interface PipelineItemProps {
  pipeline: Pipeline;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const statusConfig: Record<string, { label: string; badgeClasses: string; borderColor: string }> = {
  pending: {
    label: 'status.pending',
    badgeClasses: 'bg-warm-200 text-warm-500',
    borderColor: 'border-l-warm-300',
  },
  running: {
    label: 'status.running',
    badgeClasses: 'bg-status-running/10 text-status-running',
    borderColor: 'border-l-status-running',
  },
  paused: {
    label: 'status.stopped',
    badgeClasses: 'bg-status-warning/10 text-status-warning',
    borderColor: 'border-l-status-warning',
  },
  completed: {
    label: 'status.completed',
    badgeClasses: 'bg-status-success/10 text-status-success',
    borderColor: 'border-l-status-success',
  },
  failed: {
    label: 'status.failed',
    badgeClasses: 'bg-status-error/10 text-status-error',
    borderColor: 'border-l-status-error',
  },
  stopped: {
    label: 'status.stopped',
    badgeClasses: 'bg-status-warning/10 text-status-warning',
    borderColor: 'border-l-status-warning',
  },
  merged: {
    label: 'status.merged',
    badgeClasses: 'bg-status-merged/10 text-status-merged',
    borderColor: 'border-l-status-merged',
  },
};

const PHASE_LABEL_KEYS: Record<string, string> = {
  planning: 'pipeline.planning',
  implementation: 'pipeline.implementation',
  review: 'pipeline.review',
  feedback_impl: 'pipeline.feedback',
  documentation: 'pipeline.documentation',
};

export default function PipelineItem({ pipeline, onStart, onStop, onDelete }: PipelineItemProps) {
  const { t } = useI18n();
  const config = statusConfig[pipeline.status] || statusConfig.pending;
  const canStart = pipeline.status === 'pending' || pipeline.status === 'paused' || pipeline.status === 'failed';
  const canStop = pipeline.status === 'running';

  return (
    <div className={`card border-l-4 ${config.borderColor} overflow-hidden`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Pipeline icon */}
        <div className="flex-shrink-0 text-warm-400">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </div>

        {/* Title + phase info */}
        <Link
          to={`/projects/${pipeline.project_id}/pipelines/${pipeline.id}`}
          className="flex-1 min-w-0 group"
        >
          <span className="text-sm text-warm-800 font-medium truncate block group-hover:text-accent-gold transition-colors">
            {pipeline.title}
          </span>
          {pipeline.current_phase && (
            <span className="text-[11px] text-warm-400">
              {t('pipeline.phase')}: {t(PHASE_LABEL_KEYS[pipeline.current_phase] as any) || pipeline.current_phase}
            </span>
          )}
        </Link>

        {/* Status badge */}
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${config.badgeClasses}`}>
          {pipeline.status === 'running' && (
            <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse" />
          )}
          {t(config.label as any)}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 ml-2">
          {canStart && (
            <button
              onClick={(e) => { e.preventDefault(); onStart(pipeline.id); }}
              className="p-1.5 text-status-success/60 hover:text-status-success hover:bg-status-success/10 rounded-lg transition-colors"
              title={t('pipeline.start')}
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
          {canStop && (
            <button
              onClick={(e) => { e.preventDefault(); onStop(pipeline.id); }}
              className="p-1.5 text-status-warning/60 hover:text-status-warning hover:bg-status-warning/10 rounded-lg transition-colors"
              title={t('pipeline.pause')}
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.preventDefault(); onDelete(pipeline.id); }}
            className="p-1.5 text-warm-400 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
            title={t('todo.delete')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
