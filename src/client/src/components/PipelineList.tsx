import { useState } from 'react';
import type { Pipeline } from '../types';
import PipelineItem from './PipelineItem';
import PipelineForm from './PipelineForm';
import { useI18n } from '../i18n';

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
  const { t } = useI18n();

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-warm-600 uppercase tracking-wider">
          {t('pipelines.title')}
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary text-xs py-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('pipelines.add')}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-5 animate-slide-up">
          <PipelineForm
            onSave={async (title, description) => {
              await onAddPipeline(title, description);
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="space-y-3">
        {pipelines.length === 0 && !showForm ? (
          <div className="card p-10 text-center">
            <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-accent-gold/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </div>
            <p className="text-warm-600 font-medium">{t('pipelines.empty')}</p>
            <p className="text-warm-400 text-sm mt-1">{t('pipelines.emptyHint')}</p>
            <p className="text-warm-400 text-xs mt-2 max-w-sm mx-auto leading-relaxed">
              {t('pipelines.emptyDesc')}
            </p>
          </div>
        ) : (
          pipelines.map((pipeline, index) => (
            <div key={pipeline.id} className="animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
              <PipelineItem
                pipeline={pipeline}
                onStart={onStartPipeline}
                onStop={onStopPipeline}
                onDelete={onDeletePipeline}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
