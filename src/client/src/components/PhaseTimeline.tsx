import type { PipelinePhase } from '../types';

interface PhaseTimelineProps {
  phases: PipelinePhase[];
  currentPhase: string | null;
  selectedPhase: string | null;
  onSelectPhase: (phaseType: string) => void;
}

const PHASE_LABELS: Record<string, string> = {
  planning: '계획',
  implementation: '구현',
  review: '리뷰',
  feedback_impl: '피드백',
  documentation: '문서화',
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
    node: 'bg-street-700 border-street-500 text-street-400',
    label: 'text-street-500',
    line: 'bg-street-600',
  },
  running: {
    node: 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan animate-pulse',
    label: 'text-neon-cyan',
    line: 'bg-neon-cyan/30',
  },
  completed: {
    node: 'bg-neon-green/20 border-neon-green text-neon-green',
    label: 'text-neon-green',
    line: 'bg-neon-green/50',
  },
  failed: {
    node: 'bg-neon-pink/20 border-neon-pink text-neon-pink',
    label: 'text-neon-pink',
    line: 'bg-neon-pink/30',
  },
  skipped: {
    node: 'bg-neon-yellow/10 border-neon-yellow/50 text-neon-yellow/50',
    label: 'text-neon-yellow/50',
    line: 'bg-neon-yellow/20',
  },
};

export default function PhaseTimeline({ phases, selectedPhase, onSelectPhase }: PhaseTimelineProps) {
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
              className={`flex flex-col items-center gap-1.5 flex-shrink-0 group cursor-pointer`}
            >
              <div
                className={`
                  w-10 h-10 flex items-center justify-center border-2 font-mono text-sm font-bold
                  transition-all duration-200
                  ${style.node}
                  ${isSelected ? 'ring-2 ring-offset-2 ring-offset-street-900 ring-neon-cyan scale-110' : 'hover:scale-105'}
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
              <span className={`text-[9px] font-mono font-bold tracking-wider whitespace-nowrap ${style.label}`}>
                {PHASE_LABELS[phase.phase_type] || phase.phase_type}
              </span>
            </button>

            {/* Connecting line */}
            {index < phases.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${style.line} min-w-[12px]`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
