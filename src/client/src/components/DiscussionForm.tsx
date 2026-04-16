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

  const getRoleLabel = (agent: DiscussionAgent) => t(`agents.roles.${agent.role}`) || agent.role;

  const selectedAgents = values.agent_ids
    .map((agentId) => agents.find((agent) => agent.id === agentId))
    .filter((agent): agent is DiscussionAgent => !!agent);

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

  const moveAgent = (agentId: string, direction: -1 | 1) => {
    setValues((prev) => {
      const currentIndex = prev.agent_ids.indexOf(agentId);
      const nextIndex = currentIndex + direction;
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= prev.agent_ids.length) return prev;

      const nextAgentIds = [...prev.agent_ids];
      [nextAgentIds[currentIndex], nextAgentIds[nextIndex]] = [nextAgentIds[nextIndex], nextAgentIds[currentIndex]];

      return {
        ...prev,
        agent_ids: nextAgentIds,
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
          placeholder={lang === 'ko' ? '토론할 기능이나 의사결정 배경을 자세히 설명하세요' : 'Describe the feature to discuss in detail'}
        />
      </div>

      {allowAdvancedFields && (
        <>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-1.5">
                {t('discussions.agents')}
                <span className="ml-2 text-warm-400 font-normal">
                  {lang === 'ko'
                    ? `(${values.agent_ids.length}명 선택됨 · 최소 2명)`
                    : `(${values.agent_ids.length} selected · min 2)`}
                </span>
              </label>
              <p className="text-[11px] text-warm-400">
                {lang === 'ko'
                  ? '참여 에이전트를 고른 뒤, 아래 발언 순서에서 실제 토론 진행 순서를 조정합니다.'
                  : 'Select participants first, then adjust the actual speaking order below.'}
              </p>
            </div>

            <div className="rounded-2xl border border-accent/30 bg-accent/5 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-warm-700">
                    {lang === 'ko' ? '발언 순서' : 'Speaking Order'}
                  </div>
                  <p className="text-[11px] text-warm-500 mt-1">
                    {lang === 'ko'
                      ? '1라운드 기준이며, 이후 라운드에도 같은 순서로 반복됩니다.'
                      : 'This order is used for round 1 and repeats in later rounds.'}
                  </p>
                </div>
                {selectedAgents.length >= 2 && (
                  <div className="text-2xs font-semibold text-accent-dark bg-white/70 border border-accent/30 rounded-full px-2.5 py-1">
                    {lang === 'ko' ? '순서 조정 가능' : 'Reorder enabled'}
                  </div>
                )}
              </div>

              {selectedAgents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-warm-200 bg-white/70 px-4 py-5 text-center text-xs text-warm-400">
                  {lang === 'ko'
                    ? '에이전트를 선택하면 여기서 발언 순서를 바로 조정할 수 있습니다.'
                    : 'Select agents to adjust the speaking order here.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedAgents.map((agent, index) => {
                    const isFirst = index === 0;
                    const isLast = index === selectedAgents.length - 1;
                    const turnLabel = isFirst
                      ? (lang === 'ko' ? '첫 발언' : 'Opens the round')
                      : isLast
                        ? (lang === 'ko' ? '마지막 발언' : 'Closes the round')
                        : (lang === 'ko' ? `${index + 1}번째 발언` : `Turn ${index + 1}`);

                    return (
                      <div
                        key={agent.id}
                        className="flex flex-col gap-3 rounded-xl border border-warm-200 bg-white/85 px-3 py-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white flex-shrink-0">
                            {index + 1}
                          </div>
                          <div
                            className="w-6 h-6 rounded-full flex-shrink-0 border border-white/80 shadow-sm"
                            style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-warm-700 truncate">{agent.name}</div>
                            <div className="text-[11px] text-warm-500">
                              {getRoleLabel(agent)} · {turnLabel}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => moveAgent(agent.id, -1)}
                            disabled={isFirst}
                            className="px-2.5 py-1.5 rounded-lg border border-warm-200 bg-warm-50 text-[11px] font-medium text-warm-600 hover:bg-warm-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {lang === 'ko' ? '앞으로' : 'Earlier'}
                          </button>
                          <button
                            type="button"
                            onClick={() => moveAgent(agent.id, 1)}
                            disabled={isLast}
                            className="px-2.5 py-1.5 rounded-lg border border-warm-200 bg-warm-50 text-[11px] font-medium text-warm-600 hover:bg-warm-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {lang === 'ko' ? '뒤로' : 'Later'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {agents.length === 0 ? (
              <p className="text-xs text-warm-400 py-3 px-4 bg-warm-50 rounded-xl border border-warm-150">{t('agents.empty')}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => {
                  const selected = values.agent_ids.includes(agent.id);
                  const order = values.agent_ids.indexOf(agent.id) + 1;

                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => toggleAgent(agent.id)}
                      className={`text-left rounded-2xl border px-3.5 py-3 transition-all ${
                        selected
                          ? 'border-accent bg-accent/5 shadow-sm'
                          : 'border-warm-200 bg-warm-50 hover:border-warm-300 hover:bg-warm-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-6 h-6 rounded-full flex-shrink-0 border border-white/80 shadow-sm"
                            style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
                          />
                          <div className="min-w-0">
                            <div className={`text-sm font-semibold truncate ${selected ? 'text-warm-700' : 'text-warm-600'}`}>
                              {agent.name}
                            </div>
                            <div className="text-[11px] text-warm-400">{getRoleLabel(agent)}</div>
                          </div>
                        </div>

                        {selected && (
                          <div className="inline-flex items-center justify-center min-w-7 h-7 rounded-full bg-accent text-[11px] font-bold text-white flex-shrink-0">
                            {order}
                          </div>
                        )}
                      </div>

                      <div className={`mt-3 text-[11px] ${selected ? 'text-accent-dark' : 'text-warm-400'}`}>
                        {selected
                          ? (lang === 'ko' ? `${order}번째 발언으로 참여 중` : `Included as turn ${order}`)
                          : (lang === 'ko' ? '클릭해서 참여 에이전트에 추가' : 'Click to add this participant')}
                      </div>
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
            <p className="text-2xs text-warm-400 mt-1.5">{t('discussions.roundExplain')}</p>
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
                className="rounded border-warm-300 text-accent focus:ring-accent"
              />
              <span className="text-xs font-medium text-warm-500">{t('discussions.autoImplement')}</span>
            </label>
            <p className="text-2xs text-warm-400 mt-1 ml-6">{t('discussions.autoImplementHint')}</p>
            {values.auto_implement && (
              <div className="mt-2 ml-6">
                <label className="block text-xs font-medium text-warm-500 mb-1">{t('discussions.selectAgent')}</label>
                <select
                  value={values.implement_agent_id}
                  onChange={(e) => setField('implement_agent_id', e.target.value)}
                  className="input-field text-xs w-56"
                >
                  <option value="">{lang === 'ko' ? '-- 에이전트 선택 --' : '-- Select agent --'}</option>
                  {selectedAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name} ({getRoleLabel(agent)})</option>
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
