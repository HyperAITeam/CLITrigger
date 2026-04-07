import type { PipelinePhase } from '../types';
import { useI18n } from '../i18n';

interface PhaseTimelineProps {
  phases: PipelinePhase[];
  currentPhase: string | null;
  selectedPhase: string | null;
  onSelectPhase: (phaseType: string) => void;
}

const PHASE_LABEL_KEYS: Record<string, string> = {
  planning: 'pipeline.planning',
  implementation: 'pipeline.implementation',
  review: 'pipeline.review',
  feedback_impl: 'pipeline.feedback',
  documentation: 'pipeline.documentation',
};

const PHASE_ICONS: Record<string, string> = {
  planning: 'P',
  implementation: 'I',
  review: 'R',
  feedback_impl: 'F',
  documentation: 'D',
};

const statusStyles: Record<string, { node: string; label: string; line: string }> = {
  pending: {
    node: 'bg-warm-100 border-warm-300 text-warm-400',
    label: 'text-warm-400',
    line: 'bg-warm-200',
  },
  running: {
    node: 'bg-status-running/10 border-status-running text-status-running animate-pulse',
    label: 'text-status-running font-semibold',
    line: 'bg-status-running/30',
  },
  completed: {
    node: 'bg-status-success/10 border-status-success text-status-success',
    label: 'text-status-success',
    line: 'bg-status-success/40',
  },
  failed: {
    node: 'bg-status-error/10 border-status-error text-status-error',
    label: 'text-status-error',
    line: 'bg-status-error/30',
  },
  skipped: {
    node: 'bg-warm-100 border-warm-300/50 text-warm-300',
    label: 'text-warm-300',
    line: 'bg-warm-200/50',
  },
};

export default function PhaseTimeline({ phases, selectedPhase, onSelectPhase }: PhaseTimelineProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-1 py-4 px-2 overflow-x-auto">
      {phases.map((phase, index) => {
        const style = statusStyles[phase.status] || statusStyles.pending;
        const isSelected = selectedPhase === phase.phase_type;

        return (
          <div key={phase.id} className="flex items-center flex-1 min-w-0">
            {/* Phase node */}
            <button
              onClick={() => onSelectPhase(phase.phase_type)}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 group cursor-pointer"
            >
              <div
                className={`
                  w-10 h-10 rounded-xl flex items-center justify-center border-2 text-sm font-bold
                  transition-all duration-200
                  ${style.node}
                  ${isSelected ? 'ring-2 ring-offset-2 ring-offset-white ring-accent scale-110' : 'hover:scale-105'}
                `}
              >
                {phase.status === 'completed' ? (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                ) : phase.status === 'failed' ? (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                ) : phase.status === 'skipped' ? (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                ) : (
                  PHASE_ICONS[phase.phase_type]
                )}
              </div>
              <span className={`text-[9px] font-semibold tracking-wider whitespace-nowrap uppercase ${style.label}`}>
                {t(PHASE_LABEL_KEYS[phase.phase_type] as any) || phase.phase_type}
              </span>
            </button>

            {/* Connecting line */}
            {index < phases.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 rounded-full ${style.line} min-w-[12px]`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
