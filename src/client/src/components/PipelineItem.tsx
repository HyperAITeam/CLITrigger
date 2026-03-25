import type { Pipeline } from '../types';
import { Link } from 'react-router-dom';

interface PipelineItemProps {
  pipeline: Pipeline;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const PHASE_LABELS: Record<string, string> = {
  planning: '계획',
  implementation: '구현',
  review: '리뷰',
  feedback_impl: '피드백',
  documentation: '문서화',
};

const statusConfig: Record<string, { label: string; classes: string; borderColor: string }> = {
  pending: {
    label: 'IDLE',
    classes: 'bg-street-600 text-street-300 border-street-500',
    borderColor: 'border-l-street-500',
  },
  running: {
    label: 'LIVE',
    classes: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/50 animate-pulse',
    borderColor: 'border-l-neon-cyan',
  },
  paused: {
    label: 'PAUSE',
    classes: 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/50',
    borderColor: 'border-l-neon-yellow',
  },
  completed: {
    label: 'DONE',
    classes: 'bg-neon-green/10 text-neon-green border-neon-green/50',
    borderColor: 'border-l-neon-green',
  },
  failed: {
    label: 'FAIL',
    classes: 'bg-neon-pink/10 text-neon-pink border-neon-pink/50',
    borderColor: 'border-l-neon-pink',
  },
  stopped: {
    label: 'STOP',
    classes: 'bg-neon-yellow/10 text-neon-yellow border-neon-yellow/50',
    borderColor: 'border-l-neon-yellow',
  },
  merged: {
    label: 'MRGD',
    classes: 'bg-neon-purple/10 text-neon-purple border-neon-purple/50',
    borderColor: 'border-l-neon-purple',
  },
};

export default function PipelineItem({ pipeline, onStart, onStop, onDelete }: PipelineItemProps) {
  const config = statusConfig[pipeline.status] || statusConfig.pending;
  const canStart = pipeline.status === 'pending' || pipeline.status === 'paused' || pipeline.status === 'failed';
  const canStop = pipeline.status === 'running';

  return (
    <div className={`bg-street-800 border-2 border-street-600 border-l-4 ${config.borderColor} overflow-hidden transition-all hover:border-street-500`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Pipeline icon */}
        <div className="flex-shrink-0 text-street-500">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>

        {/* Title + phase info */}
        <Link
          to={`/projects/${pipeline.project_id}/pipelines/${pipeline.id}`}
          className="flex-1 min-w-0 group"
        >
          <span className="text-sm text-white font-mono truncate block group-hover:text-neon-cyan transition-colors">
            {pipeline.title}
          </span>
          {pipeline.current_phase && (
            <span className="text-[10px] font-mono text-street-400">
              PHASE: {PHASE_LABELS[pipeline.current_phase] || pipeline.current_phase}
            </span>
          )}
        </Link>

        {/* Status badge */}
        <span
          className={`inline-flex items-center border px-2 py-0.5 text-[10px] font-mono font-bold tracking-widest ${config.classes}`}
        >
          {pipeline.status === 'running' && (
            <span className="mr-1.5 h-1.5 w-1.5 bg-neon-cyan animate-ping" />
          )}
          {config.label}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 ml-2">
          {canStart && (
            <button
              onClick={(e) => { e.preventDefault(); onStart(pipeline.id); }}
              className="p-1.5 text-neon-green/70 hover:text-neon-green hover:bg-neon-green/10 transition-colors"
              title="Start"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
          {canStop && (
            <button
              onClick={(e) => { e.preventDefault(); onStop(pipeline.id); }}
              className="p-1.5 text-neon-pink/70 hover:text-neon-pink hover:bg-neon-pink/10 transition-colors"
              title="Pause"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.preventDefault(); onDelete(pipeline.id); }}
            className="p-1.5 text-street-500 hover:text-neon-pink hover:bg-neon-pink/10 transition-colors"
            title="Delete"
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
