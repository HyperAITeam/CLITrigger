import { useState } from 'react';
import type { Pipeline } from '../types';
import PipelineItem from './PipelineItem';
import PipelineForm from './PipelineForm';

interface PipelineListProps {
  pipelines: Pipeline[];
  onAddPipeline: (title: string, description: string) => Promise<void>;
  onStartPipeline: (id: string) => Promise<void>;
  onStopPipeline: (id: string) => Promise<void>;
  onDeletePipeline: (id: string) => Promise<void>;
}

export default function PipelineList({
  pipelines,
  onAddPipeline,
  onStartPipeline,
  onStopPipeline,
  onDeletePipeline,
}: PipelineListProps) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-3">
      {/* Add button */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-mono font-bold text-street-500 tracking-[0.2em] uppercase">
          FEATURE PIPELINES ({pipelines.length})
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="street-btn px-3 py-1 text-[10px] font-mono bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20"
        >
          {showForm ? 'CANCEL' : '+ NEW PIPELINE'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <PipelineForm
          onSave={async (title, description) => {
            await onAddPipeline(title, description);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* List */}
      {pipelines.length === 0 && !showForm ? (
        <div className="py-12 text-center">
          <p className="text-street-500 font-mono text-sm">// No pipelines yet.</p>
          <p className="text-street-600 font-mono text-xs mt-1">
            Create a pipeline to run automated feature development.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pipelines.map((pipeline) => (
            <PipelineItem
              key={pipeline.id}
              pipeline={pipeline}
              onStart={onStartPipeline}
              onStop={onStopPipeline}
              onDelete={onDeletePipeline}
            />
          ))}
        </div>
      )}
    </div>
  );
}
