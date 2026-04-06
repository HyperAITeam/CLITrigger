import { useEffect, useState } from 'react';
import type { DiscussionAgent } from '../types';
import type { DiscussionInput } from '../api/discussions';
import { useI18n } from '../i18n';

export interface DiscussionFormValues {
  title: string;
  description: string;
  agent_ids: string[];
  max_rounds: number;
  auto_implement: boolean;
  implement_agent_id: string;
}

interface DiscussionFormProps {
  agents: DiscussionAgent[];
  initialValues?: Partial<DiscussionFormValues>;
  mode: 'create' | 'edit';
  allowAdvancedFields?: boolean;
  submitting?: boolean;
  onSubmit: (values: DiscussionInput) => Promise<void>;
  onCancel: () => void;
}

const DEFAULT_VALUES: DiscussionFormValues = {
  title: '',
  description: '',
  agent_ids: [],
  max_rounds: 3,
  auto_implement: false,
  implement_agent_id: '',
};

export default function DiscussionForm({
  agents,
  initialValues,
  mode,
  allowAdvancedFields = true,
  submitting = false,
  onSubmit,
  onCancel,
}: DiscussionFormProps) {
  const { t, lang } = useI18n();
  const [values, setValues] = useState<DiscussionFormValues>({ ...DEFAULT_VALUES, ...initialValues });

  useEffect(() => {
    setValues({ ...DEFAULT_VALUES, ...initialValues });
  }, [initialValues]);

  const setField = <K extends keyof DiscussionFormValues>(field: K, value: DiscussionFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const toggleAgent = (agentId: string) => {
    setValues((prev) => {
      const nextAgentIds = prev.agent_ids.includes(agentId)
        ? prev.agent_ids.filter((id) => id !== agentId)
        : [...prev.agent_ids, agentId];

      return {
        ...prev,
        agent_ids: nextAgentIds,
        implement_agent_id: prev.implement_agent_id && !nextAgentIds.includes(prev.implement_agent_id)
          ? ''
          : prev.implement_agent_id,
      };
    });
  };

  const handleSubmit = async () => {
    if (!values.title.trim() || !values.description.trim()) return;
    if (allowAdvancedFields && values.agent_ids.length < 2) return;
    if (allowAdvancedFields && values.auto_implement && !values.implement_agent_id) return;

    await onSubmit({
      title: values.title.trim(),
      description: values.description.trim(),
      agent_ids: values.agent_ids,
      max_rounds: values.max_rounds,
      auto_implement: allowAdvancedFields ? values.auto_implement : false,
      implement_agent_id: allowAdvancedFields && values.auto_implement ? values.implement_agent_id : undefined,
    });
  };

  const canSubmit = values.title.trim()
    && values.description.trim()
    && (!allowAdvancedFields || values.agent_ids.length >= 2)
    && (!allowAdvancedFields || !values.auto_implement || !!values.implement_agent_id);

  return (
    <div className="card p-5 space-y-5">
      <div>
        <label className="block text-xs font-medium text-warm-500 mb-2">{lang === 'ko' ? '제목' : 'Title'}</label>
        <input
          type="text"
          value={values.title}
          onChange={(e) => setField('title', e.target.value)}
          className="input-field"
          placeholder={lang === 'ko' ? '토론 주제를 입력하세요' : 'Enter discussion topic'}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-warm-500 mb-2">{lang === 'ko' ? '설명' : 'Description'}</label>
        <textarea
          value={values.description}
          onChange={(e) => setField('description', e.target.value)}
          rows={4}
          className="input-field resize-y min-h-[80px]"
          placeholder={lang === 'ko' ? '토론할 기능이나 의도를 자세히 설명하세요' : 'Describe the feature to discuss in detail'}
        />
      </div>

      {allowAdvancedFields && (
        <>
          <div>
            <label className="block text-xs font-medium text-warm-500 mb-2">
              {t('discussions.agents')}
              <span className="ml-2 text-warm-400 font-normal">
                ({values.agent_ids.length}{lang === 'ko' ? '명 선택됨, 최소 2명' : ' selected, min 2'})
              </span>
            </label>
            {agents.length === 0 ? (
              <p className="text-xs text-warm-400 py-3 px-4 bg-warm-50 rounded-xl border border-warm-150">{t('agents.empty')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {agents.map((agent) => {
                  const selected = values.agent_ids.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => toggleAgent(agent.id)}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all border ${
                        selected
                          ? 'border-accent-gold bg-accent-gold/5 text-warm-700 shadow-sm'
                          : 'border-warm-200 bg-warm-50 text-warm-500 hover:border-warm-300 hover:bg-warm-100'
                      }`}
                    >
                      <div
                        className="w-5 h-5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
                      />
                      {agent.name}
                      {selected && (
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent-gold/15 text-[9px] text-accent-goldDark font-bold">
                          {values.agent_ids.indexOf(agent.id) + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-warm-500 mb-2">{t('discussions.maxRounds')}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={values.max_rounds}
              onChange={(e) => setField('max_rounds', Number(e.target.value))}
              className="input-field w-24 text-center"
            />
            <p className="text-[10px] text-warm-400 mt-1.5">{t('discussions.roundExplain')}</p>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={values.auto_implement}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setValues((prev) => ({
                    ...prev,
                    auto_implement: checked,
                    implement_agent_id: checked ? prev.implement_agent_id : '',
                  }));
                }}
                className="rounded border-warm-300 text-accent-gold focus:ring-accent-gold"
              />
              <span className="text-xs font-medium text-warm-500">{t('discussions.autoImplement')}</span>
            </label>
            <p className="text-[10px] text-warm-400 mt-1 ml-6">{t('discussions.autoImplementHint')}</p>
            {values.auto_implement && (
              <div className="mt-2 ml-6">
                <label className="block text-xs font-medium text-warm-500 mb-1">{t('discussions.selectAgent')}</label>
                <select
                  value={values.implement_agent_id}
                  onChange={(e) => setField('implement_agent_id', e.target.value)}
                  className="input-field text-xs w-56"
                >
                  <option value="">{lang === 'ko' ? '-- 에이전트 선택 --' : '-- Select agent --'}</option>
                  {agents.filter((agent) => values.agent_ids.includes(agent.id)).map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name} ({agent.role})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-warm-100">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">{t('header.cancel')}</button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="btn-primary text-xs py-2"
        >
          {submitting ? t('header.saving') : mode === 'create' ? t('discussions.add') : t('header.save')}
        </button>
      </div>
    </div>
  );
}
